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

        const room = io.sockets.adapter.rooms.get(roomId);
        if (room && room.size === 1) {
            io.to(socket.id).emit('is_host', true);
        } else {
            io.to(socket.id).emit('is_host', false);
        }
    });

    socket.on('disconnecting', () => {
        // Check rooms this socket is in
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                // If the host is leaving, assign new host to the next person ?
                // Socket.io standard behavior: the Set order *usually* preserves join order but not guaranteed.
                // For a simple app, we can just let the next event 'play/pause' work or re-assign.
                // But specifically "Host sends current playback time".
                // We'll trust the client side drift correction for now or just not handle host-migration complexly.
                // A better approach:
                // broadcast 'user_left'
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

    socket.on('disconnect', () => {
        console.log('User disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
