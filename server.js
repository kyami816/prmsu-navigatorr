// ============================================
// PRMSU Campus Navigator - Interactive Multiplayer Server
// Express + Socket.IO Backend (HTTPS)
// ============================================
// Sa itaas ng server.js
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Hindi mag-crash ang server
});

// I-log lahat ng rooms para ma-debug
setInterval(() => {
    console.log('[ROOMS] Active rooms:', rooms.size, Array.from(rooms.keys()));
}, 10000);
const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();

// Load SSL certificates for HTTPS
const certPath = path.join(__dirname, 'ssl', 'cert.pem');
const keyPath = path.join(__dirname, 'ssl', 'key.pem');

const http = require('http');
const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: "/socket.io/",
    transports: ["websocket", "polling"]
});

// ============================================
// Configuration
// ============================================
const PORT = process.env.PORT || 3000;

// ============================================
// Device & IP-Based Persistence
// ============================================
const deviceStorage = new Map(); // Map<clientIP, deviceObject>

// Device structure:
// {
//   ip: string,
//   userId: string,
//   displayName: string,
//   lastNavigation: { campus, building, destination },
//   preferences: { theme, mapZoom, etc },
//   sharedDestinations: Array,
//   navigationHistory: Array,
//   lastUpdate: timestamp
// }

// ============================================
// Room Management
// ============================================
const rooms = new Map(); // Map<roomId, roomObject>

// Room structure:
// {
//     hostSocketId: string,
//     locked: boolean,
//     sharedDestination: { name, lat, lng } | null,
//     members: Map<userId, userObject>
// }

// User structure:
// {
//     userId: string,
//     socketId: string,
//     displayName: string,
//     lat: number,
//     lng: number,
//     lastUpdate: timestamp,
//     isHost: boolean
// }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoomById(roomId) {
    return rooms.get(roomId);
}

function getRoomByUserId(userId) {
    for (const [roomId, room] of rooms) {
        if (room.members.has(userId)) {
            return { roomId, room };
        }
    }
    return null;
}

function isUserHost(roomId, userId) {
    const room = rooms.get(roomId);
    if (!room) return false;
    const user = room.members.get(userId);
    return user && user.isHost;
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

    // Log member locations with campus info
    console.log(`[ROOM] ${roomId} (${roomState.campus} Campus) broadcasting ${room.members.size} members:`, 
        roomState.members.map(m => `${m.displayName} @ (${m.lat?.toFixed(4)}, ${m.lng?.toFixed(4)})`).join(' | '));

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

// ============================================
// Socket.IO Event Handlers
// ============================================

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId || socket.id;
    const displayName = socket.handshake.query.displayName || `User-${userId.substring(0, 6)}`;
    const clientIP = getClientIP(socket);

    console.log(`[SOCKET] User connected: ${userId} (socket: ${socket.id}, IP: ${clientIP})`);

    // ========== CREATE ROOM ==========
    socket.on('create_room', (data, callback) => {
        try {
            const deviceData = getOrCreateDeviceData(clientIP, userId, displayName);
            
            const roomCode = generateRoomCode();
            const receivedCampus = (data.campus || 'main').toLowerCase().trim();
            const newRoom = {
                hostSocketId: socket.id,
                locked: false,
                sharedDestination: null,
                campus: receivedCampus,
                members: new Map()
            };

            rooms.set(roomCode, newRoom);

            // Add creator as first member (host)
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

            console.log(`[ROOM] Room ${roomCode} created by ${userId} on "${receivedCampus}" campus (IP: ${clientIP})`);
            callback({ success: true, roomCode, userId, deviceData });

            broadcastRoomState(roomCode);
        } catch (error) {
            console.error('[ERROR] create_room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== JOIN ROOM ==========
    socket.on('join_room', (data, callback) => {
        try {
            const { roomCode } = data;
            const room = rooms.get(roomCode);
            const clientIP = getClientIP(socket);
            const deviceData = getOrCreateDeviceData(clientIP, userId, displayName);

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            if (room.locked) {
                return callback({ success: false, error: 'Room is locked' });
            }

            // ── CAMPUS GUARD ──────────────────────────────────────────
            // Lobby codes are campus-scoped. A code created in Botolan
            // cannot be joined from the Main campus and vice versa.
            const joiningCampus = (data.campus || 'main').toLowerCase().trim();
            console.log(`[CAMPUS DEBUG] ${userId} attempting to join ${roomCode}. Room campus: "${room.campus}", Joining campus: "${joiningCampus}"`);
            
            if (room.campus && room.campus !== joiningCampus) {
                const CAMPUS_LABELS = {
                    main: 'Main Campus (Iba)',
                    botolan: 'Botolan Campus'
                };
                const roomLabel    = CAMPUS_LABELS[room.campus]    || room.campus;
                const joiningLabel = CAMPUS_LABELS[joiningCampus]  || joiningCampus;
                console.warn(`[CAMPUS GUARD] ${userId} on "${joiningLabel}" tried to join room ${roomCode} which belongs to "${roomLabel}" - REJECTED`);
                return callback({
                    success: false,
                    error: `This lobby was created for the ${roomLabel}. You are currently on the ${joiningLabel}. Please switch campuses and try again.`
                });
            }
            // ─────────────────────────────────────────────────────────

            // Check if user already in room
            if (room.members.has(userId)) {
                console.log(`[ROOM] User ${userId} already in room ${roomCode}, reconnecting... (campus: ${joiningCampus})`);
                socket.join(roomCode);
                callback({ success: true, roomCode, userId, isReconnect: true, deviceData });
                broadcastRoomState(roomCode);
                return;
            }

            // Add user to room
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

            console.log(`[ROOM] User ${userId} joined room ${roomCode} on "${joiningCampus}" campus (IP: ${clientIP})`);
            callback({ success: true, roomCode, userId, deviceData });

            broadcastRoomState(roomCode);
        } catch (error) {
            console.error('[ERROR] join_room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== LOCATION UPDATE ==========
    socket.on('loc', (data) => {
        try {
            const { roomCode, lat, lng } = data;
            const room = rooms.get(roomCode);

            if (!room) return;
            if (!room.members.has(userId)) return;

            const user = room.members.get(userId);
            user.lat = lat;
            user.lng = lng;
            user.lastUpdate = Date.now();
            user.socketId = socket.id;

            broadcastRoomState(roomCode);
        } catch (error) {
            console.error('[ERROR] loc:', error);
        }
    });

    // ========== SET DESTINATION (HOST ONLY) ==========
    socket.on('set_destination', (data, callback) => {
        try {
            const { roomCode, destination } = data;
            const room = rooms.get(roomCode);

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            // Server-side validation: verify user is host
            const user = room.members.get(userId);
            if (!user || !user.isHost) {
                console.warn(`[SECURITY] Non-host ${userId} attempted to set destination in ${roomCode}`);
                return callback({ success: false, error: 'Only host can set destination' });
            }

            room.sharedDestination = destination;
            console.log(`[ROOM] Destination set in ${roomCode}:`, destination);

            callback({ success: true });
            io.to(roomCode).emit('destination_updated', { destination });
            broadcastRoomState(roomCode);
        } catch (error) {
            console.error('[ERROR] set_destination:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== SEND CHAT MESSAGE ==========
    socket.on('send_message', (data, callback) => {
        try {
            const { roomCode, message, displayName, userId: msgUserId } = data;
            const room = rooms.get(roomCode);

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            if (!room.members.has(userId)) {
                return callback({ success: false, error: 'User not in room' });
            }

            // Sanitize message
            const sanitizedMessage = String(message).substring(0, 200).trim();
            if (!sanitizedMessage) {
                return callback({ success: false, error: 'Message cannot be empty' });
            }

            const messageData = {
                userId: msgUserId,
                displayName: displayName,
                message: sanitizedMessage,
                timestamp: Date.now(),
                roomCode
            };

            console.log(`[CHAT] Message in ${roomCode} from ${displayName}: ${sanitizedMessage.substring(0, 30)}...`);
            
            // Broadcast message to all users in the room
            io.to(roomCode).emit('chat_message', messageData);
            
            callback({ success: true });
        } catch (error) {
            console.error('[ERROR] send_message:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== KICK USER (HOST ONLY) ==========
    socket.on('kick_user', (data, callback) => {
        try {
            const { roomCode, targetUserId } = data;
            const room = rooms.get(roomCode);

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            // Server-side validation: verify user is host
            const user = room.members.get(userId);
            if (!user || !user.isHost) {
                console.warn(`[SECURITY] Non-host ${userId} attempted to kick user in ${roomCode}`);
                return callback({ success: false, error: 'Only host can kick users' });
            }

            if (!room.members.has(targetUserId)) {
                return callback({ success: false, error: 'User not found' });
            }

            // Get target user's socket and disconnect
            const targetUser = room.members.get(targetUserId);
            const targetSocket = io.sockets.sockets.get(targetUser.socketId);
            if (targetSocket) {
                targetSocket.emit('kicked', { reason: 'Host removed you from the lobby' });
                targetSocket.disconnect();
            }

            room.members.delete(targetUserId);

            console.log(`[ROOM] User ${targetUserId} kicked from ${roomCode} by host ${userId}`);
            callback({ success: true });

            broadcastRoomState(roomCode);
        } catch (error) {
            console.error('[ERROR] kick_user:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== LOCK ROOM (HOST ONLY) ==========
    socket.on('lock_room', (data, callback) => {
        try {
            const { roomCode, locked } = data;
            const room = rooms.get(roomCode);

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            // Server-side validation: verify user is host
            const user = room.members.get(userId);
            if (!user || !user.isHost) {
                console.warn(`[SECURITY] Non-host ${userId} attempted to lock room ${roomCode}`);
                return callback({ success: false, error: 'Only host can lock room' });
            }

            room.locked = locked;
            console.log(`[ROOM] Room ${roomCode} ${locked ? 'locked' : 'unlocked'} by host ${userId}`);

            callback({ success: true });
            broadcastRoomState(roomCode);
        } catch (error) {
            console.error('[ERROR] lock_room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== LEAVE ROOM ==========
    socket.on('leave_room', (data) => {
        try {
            const { roomCode } = data;
            const room = rooms.get(roomCode);

            if (!room || !room.members.has(userId)) return;

            // Check if leaving user is the host
            const leavingMember = room.members.get(userId);
            const isHostLeaving = leavingMember?.isHost;
            
            console.log(`[LEAVE] ${leavingMember.displayName} leaving room ${roomCode}, isHost: ${isHostLeaving}`);

            // Remove user from room
            room.members.delete(userId);
            socket.leave(roomCode);

            console.log(`[ROOM] User ${userId} left room ${roomCode}, remaining members: ${room.members.size}`);

            if (room.members.size === 0) {
                // No members left - delete the room
                rooms.delete(roomCode);
                console.log(`[ROOM] Room ${roomCode} deleted (empty)`);
            } else if (isHostLeaving) {
                // Host left but there are other members - transfer hosting
                const remainingMembers = Array.from(room.members.values());
                const newHost = remainingMembers[0]; // Pass to first remaining member
                
                console.log(`[TRANSFER] Transferring host to: ${newHost.displayName}`);
                
                // Update the new host
                newHost.isHost = true;
                room.hostSocketId = newHost.socketId;
                
                console.log(`[ROOM] Host transferred to ${newHost.displayName} in room ${roomCode}`);
                console.log(`[DEBUG] New host isHost value: ${newHost.isHost}, socketId: ${newHost.socketId}`);
                
                // Notify all members about the new host
                io.to(roomCode).emit('chat_message', {
                    userId: 'system',
                    displayName: '👑 System',
                    message: `${newHost.displayName} is now the host`,
                    timestamp: Date.now(),
                    isSystemMessage: true,
                    roomCode
                });
                
                broadcastRoomState(roomCode);
            } else {
                // Regular member left - just broadcast new state
                broadcastRoomState(roomCode);
            }
        } catch (error) {
            console.error('[ERROR] leave_room:', error);
        }
    });

    // ========== SAVE DEVICE DATA ==========
    socket.on('save_device_data', (data, callback) => {
        try {
            const clientIP = getClientIP(socket);
            saveDeviceData(clientIP, data);
            callback({ success: true });
        } catch (error) {
            console.error('[ERROR] save_device_data:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== GET DEVICE DATA ==========
    socket.on('get_device_data', (data, callback) => {
        try {
            const clientIP = getClientIP(socket);
            const deviceData = deviceStorage.get(clientIP);
            callback({ success: true, deviceData: deviceData || null });
            console.log(`[DEVICE] Data retrieved for IP ${clientIP}`);
        } catch (error) {
            console.error('[ERROR] get_device_data:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== DISCONNECT ==========
    socket.on('disconnect', () => {
        console.log(`[SOCKET] User disconnected: ${userId}`);

        // Remove user from all rooms
        const result = getRoomByUserId(userId);
        if (result) {
            const { roomId, room } = result;
            
            // Check if disconnected user was the host
            const disconnectedMember = room.members.get(userId);
            const wasHost = disconnectedMember?.isHost;
            
            console.log(`[DISCONNECT] ${disconnectedMember?.displayName} disconnected from ${roomId}, wasHost: ${wasHost}`);

            room.members.delete(userId);

            if (room.members.size === 0) {
                // No members left - delete the room
                rooms.delete(roomId);
                console.log(`[ROOM] Room ${roomId} deleted (empty)`);
            } else if (wasHost) {
                // Host disconnected but there are other members - transfer hosting
                const remainingMembers = Array.from(room.members.values());
                const newHost = remainingMembers[0]; // Pass to first remaining member
                
                console.log(`[TRANSFER] Transferring host to: ${newHost.displayName}`);
                
                // Update the new host
                newHost.isHost = true;
                room.hostSocketId = newHost.socketId;
                
                console.log(`[ROOM] Host transferred to ${newHost.displayName} in room ${roomId}`);
                console.log(`[DEBUG] New host isHost value: ${newHost.isHost}, socketId: ${newHost.socketId}`);
                
                // Notify all members about the new host
                io.to(roomId).emit('chat_message', {
                    userId: 'system',
                    displayName: '👑 System',
                    message: `${disconnectedMember.displayName} disconnected. ${newHost.displayName} is now the host`,
                    timestamp: Date.now(),
                    isSystemMessage: true,
                    roomCode: roomId
                });
                
                broadcastRoomState(roomId);
            } else {
                // Regular member disconnected - just broadcast new state
                console.log(`[DISCONNECT] Regular member disconnected, broadcasting state`);
                broadcastRoomState(roomId);
            }
        }
    });
});

// ============================================
// Server Start
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  PRMSU Campus Navigator - Interactive Server               ║
║  Listening on all interfaces (0.0.0.0:${PORT})             ║
║                                                            ║
║  Socket.IO Path: /socket.io/                               ║
║  Device Persistence: Enabled (IP-Based)                    ║
║  WebSocket Transport: Enabled                              ║
║  Security: HTTPS (Gyroscope Enabled)                       ║
║════════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[SERVER] SIGTERM received, shutting down...');
    server.close(() => {
        console.log('[SERVER] Server closed');
        process.exit(0);
    });
});
