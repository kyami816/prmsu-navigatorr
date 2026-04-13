// ============================================
// PRMSU Campus Navigator - Interactive Multiplayer Server
// Express + Socket.IO Backend
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

// Debug active rooms
setInterval(() => {
    console.log('[ROOMS] Active rooms:', rooms.size, Array.from(rooms.keys()));
}, 10000);

// ============================================
// Device & IP-Based Persistence
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

    console.log(`[ROOM] ${roomId} broadcasting ${room.members.size} members`);

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

    console.log(`[DEVICE] Data saved for IP ${clientIP}`);
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

function transferHostIfNeeded(roomId, room) {
    const hasHost = Array.from(room.members.values()).some(m => m.isHost);
    if (!hasHost && room.members.size > 0) {
        const newHost = Array.from(room.members.values())[0];
        newHost.isHost = true;
        room.hostSocketId = newHost.socketId;
        console.log(`[ROOM] ${roomId} host transferred to ${newHost.displayName}`);
    }
}
// ============================================
// Socket.IO Events
// ============================================

io.on('connection', (socket) => {

    const userId = socket.handshake.query.userId || socket.id;
    const displayName = socket.handshake.query.displayName || `User-${userId.substring(0, 6)}`;
    const clientIP = getClientIP(socket);

    console.log(`[SOCKET] User connected: ${userId} (${socket.id})`);

    // ============================================
    // CREATE ROOM
    // ============================================

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

            console.log(`[ROOM] ${roomCode} created`);

            callback({ success: true, roomCode, userId, deviceData });

            broadcastRoomState(roomCode);

        } catch (err) {

            console.error(err);

            callback({ success: false, error: err.message });

        }

    });

    // ============================================
    // JOIN ROOM
    // ============================================

    socket.on('join_room', (data, callback) => {

        try {

            const roomCode = data.roomCode;

            const room = rooms.get(roomCode);

            const deviceData = getOrCreateDeviceData(clientIP, userId, displayName);

            if (!room) {

                return callback({ success:false, error:'Room not found' });

            }

            if (room.locked) {

                return callback({ success:false, error:'Room locked' });

            }

            const joiningCampus = (data.campus || 'main').toLowerCase().trim();

            if (room.campus && room.campus !== joiningCampus) {

                return callback({
                    success:false,
                    error:'Wrong campus for this lobby'
                });

            }

            room.members.set(userId, {
                userId,
                socketId: socket.id,
                displayName,
                lat: null,
                lng: null,
                lastUpdate: Date.now(),
                isHost: false
            });

            socket.join(roomCode);

            callback({ success:true, roomCode, userId, deviceData });

            broadcastRoomState(roomCode);

        } catch (err) {

            console.error(err);

            callback({ success:false, error:err.message });

        }

    });

    // ============================================
    // LOCATION UPDATE
    // ============================================

    socket.on('loc', (data)=>{

        const room = rooms.get(data.roomCode);

        if(!room) return;

        if(!room.members.has(userId)) return;

        const user = room.members.get(userId);

        user.lat = data.lat;
        user.lng = data.lng;
        user.lastUpdate = Date.now();

        broadcastRoomState(data.roomCode);

    });

    // ============================================
    // DESTINATION
    // ============================================

    socket.on('set_destination', (data, callback)=>{

        const room = rooms.get(data.roomCode);

        if(!room) return callback({success:false,error:'Room not found'});

        const user = room.members.get(userId);

        if(!user || !user.isHost){

            return callback({success:false,error:'Only host can set destination'});

        }

        room.sharedDestination = data.destination;

        io.to(data.roomCode).emit('destination_updated',{destination:data.destination});

        broadcastRoomState(data.roomCode);

        callback({success:true});

    });

    // ============================================
    // CHAT
    // ============================================

    socket.on('send_message',(data,callback)=>{

        const room = rooms.get(data.roomCode);

        if(!room) return callback({success:false});

        const message = {
            userId:data.userId,
            displayName:data.displayName,
            message:String(data.message).substring(0,200),
            timestamp:Date.now(),
            roomCode:data.roomCode,
            isSystemMessage:data.isSystemMessage
        };

        io.to(data.roomCode).emit('chat_message',message);

        callback({success:true});

    });

   // ============================================
// LEAVE ROOM
// ============================================

socket.on('leave_room', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;

    room.members.delete(userId);
    socket.leave(data.roomCode);

    if (room.members.size === 0) {
        rooms.delete(data.roomCode);
    } else {
        transferHostIfNeeded(data.roomCode, room);
        broadcastRoomState(data.roomCode);
    }
});

// ============================================
// KICK USER
// ============================================

socket.on('kick_user', (data, callback) => {
    try {
        const room = rooms.get(data.roomCode);
        if (!room) return callback({ success: false, error: 'Room not found' });

        const requestingUser = room.members.get(userId);
        if (!requestingUser || !requestingUser.isHost) {
            return callback({ success: false, error: 'Only host can kick users' });
        }

        const targetUser = room.members.get(data.targetUserId);
        if (!targetUser) return callback({ success: false, error: 'User not found' });

        // Notify the kicked user directly via their socket
        io.to(targetUser.socketId).emit('kicked', { reason: 'You were removed by the host.' });

        // Remove from room
        room.members.delete(data.targetUserId);

        console.log(`[KICK] ${targetUser.displayName} kicked from ${data.roomCode}`);
        callback({ success: true });

        broadcastRoomState(data.roomCode);
    } catch (err) {
        console.error('[KICK ERROR]', err);
        callback({ success: false, error: err.message });
    }
});

    // ============================================
    // DEVICE DATA
    // ============================================

    socket.on('save_device_data',(data,callback)=>{

        saveDeviceData(clientIP,data);

        callback({success:true});

    });

    socket.on('get_device_data',(data,callback)=>{

        callback({
            success:true,
            deviceData:deviceStorage.get(clientIP)||null
        });

    });

    // ============================================
    // DISCONNECT
    // ============================================

   socket.on('disconnect', () => {
    console.log(`[SOCKET] Disconnected ${userId}`);

    const result = getRoomByUserId(userId);
    if (!result) return;

    const { roomId, room } = result;
    room.members.delete(userId);

    if (room.members.size === 0) {
        rooms.delete(roomId);
    } else {
        transferHostIfNeeded(roomId, room);
        broadcastRoomState(roomId);
    }
});

// ============================================
// SERVER START
// ============================================

server.listen(PORT,'0.0.0.0',()=>{

console.log(`
╔════════════════════════════════════════════╗
║ PRMSU Campus Navigator Multiplayer Server  ║
║ Running on port ${PORT}                    ║
║ Socket.IO path: /socket.io/                ║
╚════════════════════════════════════════════╝
`);

});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[SERVER] Shutting down...');
    server.close(() => process.exit(0));
});
