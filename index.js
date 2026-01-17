const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, in prod restrict this
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);

        // Notify others so Host can re-announce file if needed
        socket.to(roomId).emit('user_joined', socket.id);

        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        // Broadcast new user count
        io.to(roomId).emit('room_users_update', userCount);

        if (room && room.size === 1) {
            io.to(socket.id).emit('is_host', true);
        } else {
            io.to(socket.id).emit('is_host', false);
        }
    });

    socket.on('disconnecting', () => {
        // Check rooms this socket is in
        for (const roomName of socket.rooms) {
            if (roomName !== socket.id) {
                // Get count BEFORE they leave, minus 1? 
                // Alternatively, standard way: execute logic after they leave?
                // 'disconnecting' means they are still in rooms.
                const room = io.sockets.adapter.rooms.get(roomName);
                if (room) {
                    // They are about to leave, so new count is size - 1
                    io.to(roomName).emit('room_users_update', room.size - 1);
                }
            }
        }
    });

    socket.on('sync_action', (data) => {
        // data: { roomId, action, time, playing }
        // Broadcast to everyone else in the room
        socket.to(data.roomId).emit('sync_action', data);
        console.log(`Sync Action in ${data.roomId}:`, data);
    });

    socket.on('sync_time', (data) => {
        // data: { roomId, time }
        // Host sends this periodically. Broadcast to others for drift correction.
        socket.to(data.roomId).emit('sync_time', data);
    });

    // --- P2P Signaling ---

    // 1. Host announces they have a file
    socket.on('host_file_meta', (data) => {
        console.log(`[${data.roomId}] Host announced file:`, data.meta);
        // data: { roomId, meta: { name, size, type } }
        // Attach Host ID so clients know who to signal
        const enhancedMeta = { ...data.meta, hostId: socket.id };
        socket.to(data.roomId).emit('host_file_meta', enhancedMeta);
    });

    // 2. Peer wants to download (sends Signal/Offer to Host)
    socket.on('p2p_signal', (data) => {
        // data: { to: socketId, signal: {}, from: socketId }
        io.to(data.to).emit('p2p_signal', {
            signal: data.signal,
            from: socket.id
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
