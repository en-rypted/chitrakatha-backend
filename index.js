require('dotenv').config();
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

// --- Security: Password Authentication ---
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
console.log("🔒 Password Protection:", ACCESS_PASSWORD ? "ENABLED" : "DISABLED (Open to all)");

// Middleware for Socket.IO - REMOVED for Action-Based Auth
// io.use((socket, next) => { ... });

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', (data, callback) => {
        // Handle both old format (string) and new format (object)
        const roomId = typeof data === 'object' ? data.roomId : data;
        const password = typeof data === 'object' ? data.password : null;

        // Security Check
        if (ACCESS_PASSWORD && password !== ACCESS_PASSWORD) {
            console.log(`[Security] Join rejected for ${socket.id}: Invalid Password`);
            if (typeof callback === 'function') callback({ error: "Unauthorized" });
            return;
        }

        socket.join(roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);

        if (typeof callback === 'function') callback({ success: true });

        // Notify others so Host can re-announce file if needed

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

    // 3. Local Agent Announce (Relay to Room)
    socket.on('agent_file_announce', (data) => {
        console.log(`[${data.roomId}] Agent announced file:`, data.file.name);
        socket.to(data.roomId).emit('agent_file_announce', data);
    });

    // 4. Local Agent Download Progress (Relay to Room)
    socket.on('agent_download_progress', (data) => {
        // data: { roomId, fileName, progress, downloaded, total, speed }
        // Relay to the room so the requester (and others) can see progress
        socket.to(data.roomId).emit('agent_download_progress', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
