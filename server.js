```javascript
// ============================================
// PRMSU Campus Navigator - Interactive Multiplayer Server
// Express + Socket.IO Backend (FIXED)
// ============================================

// Prevent server crash
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// ============================================
// Imports
// ============================================

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ============================================
// Configuration
// ============================================

const PORT = process.env.PORT || 3000;

// ============================================
// Room Management
// ============================================

const rooms = new Map();

setInterval(() => {
    console.log('[ROOMS] Active rooms:', rooms.size, Array.from(rooms.keys()));
}, 10000);

// ============================================
// Device Storage
// ============================================

const deviceStorage = new Map();

// ============================================
// Socket.IO Setup
// ============================================

const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: "/socket.io/",
    transports: ["websocket", "polling"]
});

// ============================================
// Utility Functions
// ============================================

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoomByUserId(userId) {
    for (const [roomId, room] of rooms) {
        if (room.members.has(userId)) {
            return { roomId, room };
        }
    }
    return null;
}

function broadcastRoomState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const roomState = {
        roomId,
        hostSocketId: room.hostSocketId,
        locked: room.locked,
        campus: room.campus || 'main',
        sharedDestination: room.sharedDestination,
        members: Array.from(room.members.values()).map(user => ({
            userId: user.userId,
            displayName: user.displayName,
            lat: user.lat,
            lng: user.lng,
            isHost: user.isHost,
            lastUpdate: user.lastUpdate
        }))
    };

    io.to(roomId).emit('room_state', roomState);
}

function getClientIP(socket) {
    return socket.handshake.headers['x-forwarded-for']?.split(',')[0] ||
           socket.handshake.address ||
           socket.conn.remoteAddress ||
           'unknown';
}

function getOrCreateDeviceData(clientIP, userId, displayName) {
    if (!deviceStorage.has(clientIP)) {
        deviceStorage.set(clientIP, {
            ip: clientIP,
            userId,
            displayName,
            lastNavigation: null,
            preferences: {},
            sharedDestinations: [],
            navigationHistory: [],
            lastUpdate: Date.now()
        });
    }
    const device = deviceStorage.get(clientIP);
    device.lastUpdate = Date.now();
    return device;
}

function saveDeviceData(clientIP, data) {
    if (deviceStorage.has(clientIP)) {
        const device = deviceStorage.get(clientIP);
        Object.assign(device, data);
        device.lastUpdate = Date.now();
    }
}

// ============================================
// Middleware
// ============================================

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'prmsu nav web app.html'));
});

// ============================================
// Socket.IO Events
// ============================================

io.on('connection', (socket) => {

    const userId = socket.handshake.query.userId || socket.id;
    const displayName = socket.handshake.query.displayName || `User-${userId.substring(0, 6)}`;
    const clientIP = getClientIP(socket);

    console.log(`[SOCKET] Connected: ${userId}`);

    // CREATE ROOM
    socket.on('create_room', (data, callback) => {
        try {
            const deviceData = getOrCreateDeviceData(clientIP, userId, displayName);
            const roomCode = generateRoomCode();
            const campus = (data.campus || 'main').toLowerCase().trim();

            const newRoom = {
                hostSocketId: socket.id,
                locked: false,
                sharedDestination: null,
                campus,
                members: new Map()
            };

            rooms.set(roomCode, newRoom);

            newRoom.members.set(userId, {
                userId,
                socketId: socket.id,
                displayName,
                lat: null,
                lng: null,
                lastUpdate: Date.now(),
                isHost: true
            });

            socket.join(roomCode);

            callback({ success: true, roomCode, userId, deviceData });
            broadcastRoomState(roomCode);

        } catch (err) {
            callback({ success: false, error: err.message });
        }
    });

    // JOIN ROOM
    socket.on('join_room', (data, callback) => {
        try {
            const room = rooms.get(data.roomCode);
            const deviceData = getOrCreateDeviceData(clientIP, userId, displayName);

            if (!room) return callback({ success:false, error:'Room not found' });
            if (room.locked) return callback({ success:false, error:'Room locked' });

            room.members.set(userId, {
                userId,
                socketId: socket.id,
                displayName,
                lat: null,
                lng: null,
                lastUpdate: Date.now(),
                isHost: false
            });

            socket.join(data.roomCode);

            callback({ success:true, roomCode:data.roomCode, userId, deviceData });
            broadcastRoomState(data.roomCode);

        } catch (err) {
            callback({ success:false, error:err.message });
        }
    });

    // LOCATION
    socket.on('loc', (data)=>{
        const room = rooms.get(data.roomCode);
        if(!room) return;
        const user = room.members.get(userId);
        if(!user) return;

        user.lat = data.lat;
        user.lng = data.lng;
        user.lastUpdate = Date.now();

        broadcastRoomState(data.roomCode);
    });

    // DESTINATION
    socket.on('set_destination', (data, callback)=>{
        const room = rooms.get(data.roomCode);
        if(!room) return callback({success:false});

        const user = room.members.get(userId);
        if(!user || !user.isHost) return callback({success:false});

        room.sharedDestination = data.destination;

        io.to(data.roomCode).emit('destination_updated',{destination:data.destination});
        broadcastRoomState(data.roomCode);

        callback({success:true});
    });

    // CHAT
    socket.on('send_message',(data,callback)=>{
        const room = rooms.get(data.roomCode);
        if(!room) return callback({success:false});

        io.to(data.roomCode).emit('chat_message',{
            userId:data.userId,
            displayName:data.displayName,
            message:String(data.message).substring(0,200),
            timestamp:Date.now(),
            isSystemMessage:data.isSystemMessage
        });

        callback({success:true});
    });

    // KICK USER (FIXED)
    socket.on('kick_user', (data, callback) => {

        const room = rooms.get(data.roomCode);
        if (!room) return callback({ success:false });

        const requester = room.members.get(userId);
        if (!requester || !requester.isHost) {
            return callback({ success:false });
        }

        const targetUser = room.members.get(data.targetUserId);
        if (!targetUser) return callback({ success:false });

        room.members.delete(data.targetUserId);

        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
            targetSocket.leave(data.roomCode);
            targetSocket.emit('kicked', { reason: 'Removed by host' });
        }

        broadcastRoomState(data.roomCode);

        callback({ success:true });
    });

    // LEAVE ROOM (FIXED HOST TRANSFER)
    socket.on('leave_room',(data)=>{
        const room = rooms.get(data.roomCode);
        if(!room) return;

        const wasHost = room.members.get(userId)?.isHost;

        room.members.delete(userId);
        socket.leave(data.roomCode);

        if(room.members.size===0){
            rooms.delete(data.roomCode);
        } else {

            if (wasHost) {
                const newHost = Array.from(room.members.values())[0];
                if (newHost) {
                    newHost.isHost = true;
                    room.hostSocketId = newHost.socketId;
                }
            }

            broadcastRoomState(data.roomCode);
        }
    });

    // DISCONNECT (FIXED HOST TRANSFER)
    socket.on('disconnect',()=>{

        const result = getRoomByUserId(userId);
        if(!result) return;

        const {roomId,room} = result;

        const wasHost = room.members.get(userId)?.isHost;

        room.members.delete(userId);

        if(room.members.size===0){
            rooms.delete(roomId);
        } else {

            if (wasHost) {
                const newHost = Array.from(room.members.values())[0];
                if (newHost) {
                    newHost.isHost = true;
                    room.hostSocketId = newHost.socketId;
                }
            }

            broadcastRoomState(roomId);
        }
    });

});

// ============================================
// START SERVER
// ============================================

server.listen(PORT,'0.0.0.0',()=>{
    console.log(`Server running on port ${PORT}`);
});
```
