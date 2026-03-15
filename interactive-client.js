// ============================================
// PRMSU Campus Navigator - Interactive Mode Client
// Socket.IO Connection & Multiplayer Logic
// ============================================

// ============================================
// State Management (Multiplayer Only)
// ============================================

// Fallback UUID generator for browsers that don't support crypto.randomUUID()
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    
    // Fallback UUID v4 generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const multiplayerState = {
    socket: null,
    userId: null,
    roomCode: null,
    isInLobby: false,
    isHosting: false,
    locationPermissionConfirmed: false,
    locationWatchId: null,
    lastLocationUpdate: 0,
    lastLocation: { lat: null, lng: null },
    otherUsers: new Map(), // userId -> {displayName, lat, lng, marker, labelOverlay, polyline, userRoute, isHost}
    currentUserMarker: null,
    currentUserLabelOverlay: null,  // NEW: Store current user label overlay reference
    currentUserPolyline: null,
    currentUserRoute: null,
    roomMembers: [],
    sharedDestination: null,
    deviceData: null,  // IP-based device data
    routeAnimationInterval: null,  // Stores arrow animation interval ID for interactive mode
    destinationMarker: null,  // Destination marker on map
    outsideRoutePolyline: null,
    distanceUpdateInterval: null  // Stores interval for periodic distance/ETA broadcasts
};

// ============================================
// Initialization
// ============================================
function loadDeviceData() {
    if (!multiplayerState.socket) return;

    const socket = multiplayerState.socket;
    socket.emit('get_device_data', {}, (response) => {
        if (response.success && response.deviceData) {
            multiplayerState.deviceData = response.deviceData;
            console.log('[DEVICE] Data loaded from server');

            // Restore previous navigation state if available
            if (response.deviceData.lastNavigation) {
                const lastNav = response.deviceData.lastNavigation;
                console.log('[DEVICE] Restoring last navigation:', lastNav);
                // Could restore campus, building, etc. here if needed
            }

            // Restore preferences
            if (response.deviceData.preferences) {
                console.log('[DEVICE] Restoring preferences:', response.deviceData.preferences);
                // Apply preferences to UI
            }
        } else {
            console.log('[DEVICE] No previous device data found');
            multiplayerState.deviceData = {
                userId: multiplayerState.userId,
                displayName: state.user || 'User',
                lastNavigation: null,
                preferences: {},
                sharedDestinations: [],
                navigationHistory: [],
                lastUpdate: Date.now()
            };
        }
    });
}

function saveDeviceData() {
    if (!multiplayerState.socket) return;

    // Prepare current state to save
    const dataToSave = {
        lastNavigation: {
            campus: state.campus,
            building: state.selectedBuilding,
            destination: state.destination ? {
                name: state.destination.d,
                lat: state.destination.lat,
                lng: state.destination.lng
            } : null
        },
        preferences: {
            mapZoom: state.map ? state.map.getZoom() : 15,
            theme: localStorage.getItem('theme') || 'light'
        },
        sharedDestinations: Array.from(document.querySelectorAll('[data-bookmark]'))
            .map(el => ({
                name: el.textContent,
                lat: parseFloat(el.dataset.lat),
                lng: parseFloat(el.dataset.lng)
            })),
        navigationHistory: state.navigationHistory || [],
        lastUpdate: Date.now()
    };

    const socket = multiplayerState.socket;
    socket.emit('save_device_data', dataToSave, (response) => {
        if (response.success) {
            console.log('[DEVICE] Data saved to server');
            multiplayerState.deviceData = dataToSave;
        } else {
            console.warn('[DEVICE] Failed to save:', response.error);
        }
    });
}

// Auto-save device data periodically (every 30 seconds)
setInterval(() => {
    if (multiplayerState.socket && multiplayerState.socket.connected) {
        saveDeviceData();
    }
}, 30000);
function initializeMultiplayer() {
    // Get or create userId from localStorage
    const storedUserId = localStorage.getItem('prmsuUserId');
    if (!storedUserId) {
        multiplayerState.userId = generateUUID();
        localStorage.setItem('prmsuUserId', multiplayerState.userId);
        console.log('[MULTIPLAYER] Generated new userId:', multiplayerState.userId);
    } else {
        multiplayerState.userId = storedUserId;
        console.log('[MULTIPLAYER] Using stored userId:', multiplayerState.userId);
    }

    // Initialize Socket.IO connection
    const socketURL = "prmsu-navigatorr-production.up.railway.app";
    multiplayerState.socket = io(socketURL, {
        path: "/socket.io/",
        transports: ["websocket", "polling"],
        query: {
            userId: multiplayerState.userId,
            displayName: state.user || `User-${multiplayerState.userId.substring(0, 6)}`
        }
    });

    // Setup socket event listeners
    setupSocketListeners();

    // Load device data from server (IP-based persistence)
    loadDeviceData();

    console.log('[MULTIPLAYER] Initialized. UserId:', multiplayerState.userId);
}

function setupSocketListeners() {
    const socket = multiplayerState.socket;

    // ===== CONNECTION EVENTS =====
    socket.on('connect', () => {
        console.log('[SOCKET] Connected:', socket.id);
        // If reconnecting to a lobby, rejoin
        if (multiplayerState.roomCode && multiplayerState.isInLobby) {
            attemptReconnectToLobby();
        }
    });

    socket.on('disconnect', () => {
        console.log('[SOCKET] Disconnected');
        if (multiplayerState.isInLobby) {
            // Will attempt to reconnect automatically
            console.log('[SOCKET] Will attempt to reconnect...');
        }
    });

    socket.on('connect_error', (error) => {
        console.error('[SOCKET] Connection error:', error.message);
        if (typeof showNotification === 'function') {
            showNotification('Connection error: ' + error.message, 'error', 5000);
        }
    });

    socket.on('error', (error) => {
        console.error('[SOCKET] Error:', error);
    });

    // ===== ROOM STATE UPDATES =====
    socket.on('room_state', (roomState) => {
        console.log('[ROOM] State update received:', {
            roomId: roomState.roomId,
            campus: roomState.campus,
            memberCount: roomState.members.length,
            destination: roomState.sharedDestination?.name || 'none'
        });
        console.log('[ROOM] Members:', roomState.members.map(m => `${m.displayName} @ (${m.lat?.toFixed(4)}, ${m.lng?.toFixed(4)})`).join(' | '));

        // Detect new users joining
        const previousCount = multiplayerState.roomMembers?.length || 0;
        const newMembers = roomState.members.filter(m => 
            !multiplayerState.roomMembers?.some(prev => prev.userId === m.userId)
        );
        
        if (newMembers.length > 0 && previousCount > 0) {
            newMembers.forEach(member => {
                multiplayerState.socket.emit('send_message', {
                    roomCode: multiplayerState.roomCode,
                    message: `${member.displayName} joined the lobby`,
                    displayName: '✅ System',
                    userId: 'system',
                    isSystemMessage: true,
                    timestamp: Date.now()
                }, (response) => {
                    if (response?.success) {
                        console.log('[ROOM] Join notification sent for:', member.displayName);
                    } else {
                        console.error('[ROOM] Failed to send join notification:', response?.error);
                    }
                });
            });
        }

        multiplayerState.roomMembers = roomState.members;
        multiplayerState.sharedDestination = roomState.sharedDestination;

        // Update active users indicator
        const activeUserCount = roomState.members.length;
        const activeUsersText = document.getElementById('activeUsersText');
        const participantCount = document.getElementById('participantCount');
        if (activeUsersText) {
            activeUsersText.textContent = `${activeUserCount} active user${activeUserCount !== 1 ? 's' : ''}`;
        }
        if (participantCount) {
            participantCount.textContent = activeUserCount;
        }

        // Update isHosting status
        multiplayerState.isHosting = roomState.members.some(m => m.userId === multiplayerState.userId && m.isHost);

        // Update UI
        updateMembersUI(roomState);
        updateHostUIElements();
        updateSharedDestinationUI();

        // Update CURRENT USER's own marker and route
        const currentUser = roomState.members.find(m => m.userId === multiplayerState.userId);
        if (currentUser) {
            updateCurrentUserMarker(currentUser);
        }

        // Update other users' markers on map
        console.log('[ROOM] Calling updateOtherUsersMarkers with', roomState.members.length, 'members');
        updateOtherUsersMarkers(roomState.members);

        // REGENERATE ALL ROUTES if destination is set
        if (multiplayerState.sharedDestination) {
            regenerateAllRoutes();
        }
    });

    // ===== KICKED FROM ROOM =====
    socket.on('kicked', (data) => {
        console.log('[ROOM] Kicked:', data.reason);
        if (typeof showNotification === 'function') {
            showNotification('You were removed from the lobby: ' + data.reason, 'warning', 6000);
        }
        // Execute leave directly without confirmation dialog
        _executeLeaveLobby();
    });

    // ===== CHAT MESSAGES =====
    socket.on('chat_message', (messageData) => {
        console.log('[CHAT] Received message:', messageData);
        displayChatMessage(messageData);
    });

    // ===== SHARED DESTINATION UPDATE =====
    socket.on('destination_updated', (data) => {
        multiplayerState.sharedDestination = data.destination;
        updateSharedDestinationUI();
        regenerateAllRoutes();
    });
}

// ============================================
// Lobby Management
// ============================================
function createLobby() {
    console.log('[LOBBY] CREATE LOBBY clicked');
    console.log('[LOBBY] Socket exists?', !!multiplayerState.socket);
    console.log('[LOBBY] Socket connected?', multiplayerState.socket?.connected);
    
    try {
        if (!multiplayerState.socket) {
            console.log('[LOBBY] Socket not initialized. Initializing now...');
            initializeMultiplayer();
            console.log('[LOBBY] Socket initialized');
        }
        
        // Wait for socket to connect before proceeding
        if (!multiplayerState.socket.connected) {
            console.log('[LOBBY] Socket not connected yet. Waiting for connection...');
            const timeout = setTimeout(() => {
                console.error('[LOBBY] Connection timeout after 10 seconds');
                if (typeof showNotification === 'function') {
                    showNotification('Failed to connect. Check your internet connection.', 'error', 6000);
                }
            }, 10000);
            
            multiplayerState.socket.once('connect', () => {
                clearTimeout(timeout);
                console.log('[LOBBY] Socket connected. Now creating room...');
                createLobbyAfterConnect();
            });
            
            // Try to establish connection if not already connecting
            if (!multiplayerState.socket.connecting) {
                console.log('[LOBBY] Socket not connecting. Forcing connection...');
                multiplayerState.socket.connect();
            }
            return;
        }
        
        console.log('[LOBBY] Socket already connected. Creating room now...');
        createLobbyAfterConnect();
    } catch (error) {
        console.error('[LOBBY] ERROR in createLobby:', error);
        if (typeof showNotification === 'function') {
            showNotification('Error: ' + error.message, 'error', 6000);
        }
    }
}

function createLobbyAfterConnect() {
    const socket = multiplayerState.socket;
    const displayName = state.user || 'User';
    const campus = state.campus || 'main';

    socket.emit('create_room', { displayName, campus }, (response) => {
        if (response.success) {
            multiplayerState.roomCode = response.roomCode;
            multiplayerState.isInLobby = true;
            multiplayerState.isHosting = true;

            // Store device data from response
            if (response.deviceData) {
                multiplayerState.deviceData = response.deviceData;
            }

            // Store current campus for interactive mode
            lobbyState.campus = campus;

            console.log('[ROOM] Created room:', response.roomCode);

            // Navigate to interactive screen
            showScreen('interactive-screen');
            updateLobbyCodeDisplay(response.roomCode);
            
            // Auto-start location sharing
            setTimeout(() => {
                if (!multiplayerState.locationWatchId) {
                    startLocationSharing();
                }
            }, 500);

            // Auto-close modal if open
            closeJoinLobbyModal();

            // Save current state to device
            saveDeviceData();
        } else {
            const errorMsg = response.error || 'Unknown error';
            console.error('[ROOM] Failed to create lobby:', {
                campus: campus,
                error: errorMsg
            });
            if (typeof showNotification === 'function') {
                showNotification('Failed to create lobby: ' + errorMsg, 'error', 6000);
            }
        }
    });
}

function joinLobby() {
    console.log('[LOBBY] JOIN LOBBY clicked');
    console.log('[LOBBY] Socket exists?', !!multiplayerState.socket);
    console.log('[LOBBY] Socket connected?', multiplayerState.socket?.connected);
    
    const roomCode = document.getElementById('joinLobbyCode')?.value?.toUpperCase()?.trim();
    console.log('[LOBBY] Room code entered:', roomCode);

    if (!roomCode || roomCode.length !== 6) {
        if (typeof showNotification === 'function') {
            showNotification('Please enter a valid 6-character lobby code', 'warning', 5000);
        }
        return;
    }

    try {
        if (!multiplayerState.socket) {
            console.log('[LOBBY] Socket not initialized. Initializing now...');
            initializeMultiplayer();
            console.log('[LOBBY] Socket initialized');
        }
        
        if (!multiplayerState.socket.connected) {
            console.log('[LOBBY] Socket not connected yet. Waiting for connection...');
            const timeout = setTimeout(() => {
                console.error('[LOBBY] Connection timeout after 10 seconds');
                if (typeof showNotification === 'function') {
                    showNotification('Failed to connect. Check your internet connection.', 'error', 6000);
                }
            }, 10000);
            
            multiplayerState.socket.once('connect', () => {
                clearTimeout(timeout);
                console.log('[LOBBY] Socket connected. Now joining room...');
                joinLobbyAfterConnect(roomCode);
            });
            
            // Try to establish connection if not already connecting
            if (!multiplayerState.socket.connecting) {
                console.log('[LOBBY] Socket not connecting. Forcing connection...');
                multiplayerState.socket.connect();
            }
            return;
        }
        
        console.log('[LOBBY] Socket already connected. Joining room now...');
        joinLobbyAfterConnect(roomCode);
    } catch (error) {
        console.error('[LOBBY] ERROR in joinLobby:', error);
        if (typeof showNotification === 'function') {
            showNotification('Error: ' + error.message, 'error', 6000);
        }
    }
}

function joinLobbyAfterConnect(roomCode) {
    const socket = multiplayerState.socket;
    const displayName = state.user || 'User';
    const campus = state.campus || 'main';

    socket.emit('join_room', { roomCode, displayName, campus }, (response) => {
        if (response.success) {
            multiplayerState.roomCode = response.roomCode;
            multiplayerState.isInLobby = true;

            // Store device data from response
            if (response.deviceData) {
                multiplayerState.deviceData = response.deviceData;
            }

            // Store current campus for interactive mode
            lobbyState.campus = campus;

            console.log('[ROOM] Joined room:', response.roomCode);

            // Navigate to interactive screen
            showScreen('interactive-screen');
            updateLobbyCodeDisplay(response.roomCode);
            
            // Auto-start location sharing
            setTimeout(() => {
                if (!multiplayerState.locationWatchId) {
                    startLocationSharing();
                }
            }, 500);

            // Clear input
            document.getElementById('joinLobbyCode').value = '';
            closeJoinLobbyModal();

            // Save current state to device
            saveDeviceData();
        } else {
            const errorMsg = response.error || 'Unknown error';
            console.error('[ROOM] Failed to join lobby:', {
                roomCode: roomCode,
                campus: campus,
                error: errorMsg
            });
            if (typeof showNotification === 'function') {
                showNotification('Failed to join lobby: ' + errorMsg, 'error', 6000);
            }
        }
    });
}

function attemptReconnectToLobby() {
    if (!multiplayerState.roomCode || !multiplayerState.isInLobby) {
        return;
    }

    if (!multiplayerState.socket) {
        console.log('[LOBBY] No socket on reconnect attempt. Initializing...');
        initializeMultiplayer();
        
        if (!multiplayerState.socket.connected) {
            multiplayerState.socket.once('connect', () => {
                console.log('[LOBBY] Socket connected on reconnect. Rejoin room...');
                attemptReconnectAfterConnect();
            });
            return;
        }
    }

    // Socket is ready
    if (multiplayerState.socket && multiplayerState.socket.connected) {
        attemptReconnectAfterConnect();
    } else if (multiplayerState.socket) {
        // Socket exists but not connected yet
        console.log('[LOBBY] Waiting for socket connection to rejoin...');
        multiplayerState.socket.once('connect', () => {
            console.log('[LOBBY] Socket now connected. Rejoining room...');
            attemptReconnectAfterConnect();
        });
    }
}

function attemptReconnectAfterConnect() {
    const socket = multiplayerState.socket;
    const displayName = state.user || 'User';
    const campus = state.campus || 'main';

    socket.emit('join_room', { roomCode: multiplayerState.roomCode, displayName, campus }, (response) => {
        if (response.success) {
            // Store current campus for interactive mode
            lobbyState.campus = campus;
            
            console.log('[ROOM] Reconnected to room:', response.roomCode);
            if (!multiplayerState.locationWatchId) {
                startLocationSharing();
            }
        } else {
            console.warn('[ROOM] Failed to reconnect:', response.error);
            leaveLobby();
        }
    });
}

function leaveLobby() {
    if (!multiplayerState.roomCode) return;

    // Show styled confirmation dialog
    showConfirmationDialog(
        'Leave Lobby?',
        'You will disconnect from other users.',
        () => {
            // Confirmed - proceed with leaving
            _executeLeaveLobby();
        }
    );
}

function _executeLeaveLobby() {
    // Save current state before leaving
    saveDeviceData();

    // Stop distance notifications
    stopDistanceNotifications();

    const socket = multiplayerState.socket;
    socket.emit('leave_room', { roomCode: multiplayerState.roomCode });

    stopLocationSharing();
    if (multiplayerState.outsideRoutePolyline) {
        try { multiplayerState.outsideRoutePolyline.setMap(null); } catch (e) {}
        multiplayerState.outsideRoutePolyline = null;
    }

    clearOtherUsersMarkers();

    multiplayerState.isInLobby = false;
    multiplayerState.isHosting = false;
    multiplayerState.roomCode = null;
    multiplayerState.roomMembers = [];
    multiplayerState.sharedDestination = null;
    multiplayerState.otherUsers.clear();

    // Clear all mobile drawer classes to remove blur/backdrop
    document.body.classList.remove('lobby-sidebar-open');
    document.body.classList.remove('lobby-chat-open');
    document.body.classList.remove('lobby-chat-collapsed');

    // Return to mode selection
    showScreen('mode-screen');

    console.log('[ROOM] Left lobby');
}

function showJoinLobbyModal() {
    console.log('[MODAL] SHOW JOIN MODAL clicked');
    try {
        const modal = document.getElementById('joinLobbyModal');
        console.log('[MODAL] Modal element found?', !!modal);
        
        if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
            const input = document.getElementById('joinLobbyCode');
            console.log('[MODAL] Input element found?', !!input);
            if (input) {
                input.focus();
                console.log('[MODAL] Modal shown and focused');
            } else {
                console.error('[MODAL] Join lobby code input not found');
            }
        } else {
            console.error('[MODAL] Join lobby modal not found in DOM');
        }
    } catch (error) {
        console.error('[MODAL] ERROR in showJoinLobbyModal:', error);
    }
}

function closeJoinLobbyModal() {
    const modal = document.getElementById('joinLobbyModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

function copyLobbyCode() {
    const code = multiplayerState.roomCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
        const btn = event.target.closest('.copy-btn, .copy-btn-large');
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => {
                btn.innerHTML = originalContent;
            }, 2000);
        }
    });
}

// ============================================
// Location Sharing
// ============================================
function startLocationSharing() {
    if (multiplayerState.locationWatchId !== null) {
        return; // Already sharing
    }

    if (!multiplayerState.locationPermissionConfirmed && typeof showLocationPermissionPanel === 'function') {
        showLocationPermissionPanel()
            .then(() => {
                multiplayerState.locationPermissionConfirmed = true;
                startLocationSharing();
            })
            .catch(() => {
                if (typeof showNotification === 'function') {
                    showNotification('Location permission denied.', 'warning', 5000);
                }
            });
        return;
    }

    console.log('[GEO] Starting location sharing');

    const shareButton = document.getElementById('shareLocationBtn');
    if (shareButton) {
        shareButton.classList.add('active');
    }

    multiplayerState.locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            sendLocationUpdate(latitude, longitude);
        },
        (error) => {
            console.error('[GEO] Error:', error.message);
            stopLocationSharing();
            if (typeof showNotification === 'function') {
                showNotification('Unable to access your location. Please enable location services.', 'error', 6000);
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function stopLocationSharing() {
    if (multiplayerState.locationWatchId !== null) {
        navigator.geolocation.clearWatch(multiplayerState.locationWatchId);
        multiplayerState.locationWatchId = null;

        console.log('[GEO] Stopped location sharing');

        const shareButton = document.getElementById('shareLocationBtn');
        if (shareButton) {
            shareButton.classList.remove('active');
        }
    }
}

function toggleLocationSharing() {
    if (multiplayerState.locationWatchId !== null) {
        stopLocationSharing();
    } else {
        startLocationSharing();
    }
}

function sendLocationUpdate(lat, lng) {
    if (!multiplayerState.isInLobby) {
        return;
    }
    if (!multiplayerState.socket) {
        return;
    }

    // ULTRA-LIVE: Send on EVERY location change with minimal throttling
    const now = Date.now();
    const timeSinceLastUpdate = now - multiplayerState.lastLocationUpdate;

    // Only throttle to prevent flooding - send every 100ms (10x per second)
    if (timeSinceLastUpdate < 100) {
        return; // Too soon
    }

    // Calculate distance moved
    const distance = haversine(
        multiplayerState.lastLocation.lat,
        multiplayerState.lastLocation.lng,
        lat,
        lng
    );

    // ALWAYS send if moved at least 1 meter
    if (distance < 1 && timeSinceLastUpdate < 3000) {
        return; // Less than 1 meter and less than 3 seconds
    }

    multiplayerState.lastLocationUpdate = now;
    multiplayerState.lastLocation = { lat, lng };

    // Send to server
    multiplayerState.socket.emit('loc', {
        roomCode: multiplayerState.roomCode,
        lat,
        lng
    });

    // Periodically save device data
    if (now % 60000 < 100) {
        saveDeviceData();
    }
}

// ============================================
// Host Controls
// ============================================
function kickUser(userId) {
    if (!multiplayerState.isHosting) {
        if (typeof showNotification === 'function') {
            showNotification('Only the host can kick users', 'warning', 5000);
        }
        return;
    }

    // Show styled confirmation dialog
    showConfirmationDialog(
        'Remove User?',
        'This user will be removed from the lobby.',
        () => {
            // Confirmed - proceed with kick
            _executeKickUser(userId);
        }
    );
}

function _executeKickUser(userId) {
    const socket = multiplayerState.socket;
    
    // Find the kicked user's name for notification
    const kickedMember = multiplayerState.roomMembers.find(m => m.userId === userId);
    const kickedName = kickedMember ? kickedMember.displayName : 'Unknown User';
    
    socket.emit('kick_user', { roomCode: multiplayerState.roomCode, targetUserId: userId }, (response) => {
        if (response.success) {
            console.log('[ROOM] User kicked:', userId);
            
            // Send notification to group chat
            socket.emit('send_message', {
                roomCode: multiplayerState.roomCode,
                message: `${kickedName} was removed from the lobby`,
                displayName: '🚨 System',
                userId: 'system',
                isSystemMessage: true,
                timestamp: Date.now()
            }, (response) => {
                if (response?.success) {
                    console.log('[ROOM] Kick notification sent to chat');
                } else {
                    console.error('[ROOM] Failed to send kick notification');
                }
            });
        } else {
            if (typeof showNotification === 'function') {
                showNotification('Failed to kick user: ' + (response.error || 'Unknown error'), 'error', 6000);
            }
        }
    });
}

function lockLobby() {
    if (!multiplayerState.isHosting) {
        if (typeof showNotification === 'function') {
            showNotification('Only the host can lock the lobby', 'warning', 5000);
        }
        return;
    }

    const isLocked = multiplayerState.roomMembers.some(m => m.isHost) ? true : false;
    const socket = multiplayerState.socket;

    socket.emit('lock_room', { roomCode: multiplayerState.roomCode, locked: !isLocked }, (response) => {
        if (response.success) {
            console.log('[ROOM] Lobby lock toggled');
        } else {
            if (typeof showNotification === 'function') {
                showNotification('Failed to lock lobby: ' + (response.error || 'Unknown error'), 'error', 6000);
            }
        }
    });
}

function setSharedDestination(location) {
    if (!multiplayerState.isHosting) {
        if (typeof showNotification === 'function') {
            showNotification('Only the host can set the destination', 'warning', 5000);
        }
        return;
    }

    const socket = multiplayerState.socket;
    
    // Hide all markers and show only destination marker
    hideNonDestinationMarkersAndShowDestination(location);
    
    socket.emit('set_destination', {
        roomCode: multiplayerState.roomCode,
        destination: {
            name: location.name,
            lat: location.lat,
            lng: location.lng
        }
    }, (response) => {
        if (!response || !response.success) {
            if (typeof showNotification === 'function') {
                showNotification('Failed to set destination: ' + (response?.error || 'Unknown error'), 'error', 6000);
            }
        } else {
            // Start periodic distance/ETA notifications when destination is set
            startDistanceNotifications();
        }
    });
}

function isInsideCampusInteractive(lat, lng) {
    const campus = lobbyState.campus || 'main';
    const bounds = CAMPUS_CONFIG?.[campus]?.bounds;
    if (!bounds) return true;
    return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

function findNearestGateInteractive(lat, lng) {
    const campus = lobbyState.campus || 'main';
    const gates = (typeof CAMPUS_GATES !== 'undefined' && CAMPUS_GATES?.[campus]) ? CAMPUS_GATES[campus] : [];
    if (!gates || gates.length === 0) return null;

    let nearestGate = null;
    let minDist = Infinity;
    gates.forEach(gate => {
        const dist = haversine(lat, lng, gate.lat, gate.lng);
        if (dist < minDist) {
            minDist = dist;
            nearestGate = gate;
        }
    });
    return nearestGate;
}

function drawOutsideCampusRouteToGateInteractive(start, gate) {
    if (!lobbyState.map || !window.google || !window.google.maps) return;
    if (!start || !gate) return;

    if (multiplayerState.outsideRoutePolyline) {
        try { multiplayerState.outsideRoutePolyline.setMap(null); } catch (e) {}
        multiplayerState.outsideRoutePolyline = null;
    }

    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route({
        origin: { lat: start.lat, lng: start.lng },
        destination: { lat: gate.lat, lng: gate.lng },
        travelMode: window.google.maps.TravelMode.WALKING,
        provideRouteAlternatives: false
    }, (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK && result?.routes?.length) {
            multiplayerState.outsideRoutePolyline = new window.google.maps.Polyline({
                path: result.routes[0].overview_path.map(latlng => ({ lat: latlng.lat(), lng: latlng.lng() })),
                geodesic: true,
                strokeColor: '#1976D2',
                strokeOpacity: 1,
                strokeWeight: 8,
                map: lobbyState.map,
                zIndex: 900
            });
        }
    });

    if (typeof showNotification === 'function') {
        showNotification(`📍 You are outside campus. Proceed to ${gate.name} to enter.`, 'info', 5000);
    }
}

// ============================================
// UI Updates
// ============================================
function updateLobbyCodeDisplay(code) {
    const codeElements = document.querySelectorAll(
        '#lobbyCode, #lobbyCodeDisplay, .code-value, .code-value-large'
    );
    codeElements.forEach(el => {
        el.textContent = code;
    });
}

// ============================================
// User Label Overlay Helper
// ============================================

function createUserLabelOverlay(username, initialPosition, map, isCurrentUser = false) {
    // Create label div
    const labelDiv = document.createElement('div');
    labelDiv.className = 'marker-label';
    labelDiv.textContent = isCurrentUser ? `${username} (YOU)` : username;
    labelDiv.style.fontWeight = isCurrentUser ? '700' : '500';
    labelDiv.style.fontSize = isCurrentUser ? '12px' : '11px';

    // Create LabelOverlay class
    class UserLabelOverlay extends google.maps.OverlayView {
        constructor(position, labelDiv, map) {
            super();
            this.position = position;
            this.labelDiv = labelDiv;
            this.setMap(map);
        }

        onAdd() {
            this.getPanes().overlayImage.appendChild(this.labelDiv);
        }

        draw() {
            const projection = this.getProjection();
            if (!projection) return;
            const pos = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
            if (pos) {
                this.labelDiv.style.left = pos.x + 'px';
                this.labelDiv.style.top = pos.y + 'px';
            }
        }

        onRemove() {
            if (this.labelDiv.parentNode) {
                this.labelDiv.parentNode.removeChild(this.labelDiv);
            }
        }

        updatePosition(newPosition) {
            this.position = newPosition;
            this.draw();
        }
    }

    return new UserLabelOverlay(initialPosition, labelDiv, map);
}

function updateMembersUI(roomState) {
    const participantsList = document.getElementById('participantsList');
    const participantCount = document.getElementById('participantCount');

    if (!participantsList) return;

    participantCount.textContent = roomState.members.length;

    participantsList.innerHTML = roomState.members.map(member => {
        const isMe = member.userId === multiplayerState.userId;
        const isHost = member.isHost;
        const hasLocation = member.lat !== null && member.lng !== null;
        const lastUpdateTime = new Date(member.lastUpdate).toLocaleTimeString();

        return `
            <div class="user-item ${isMe ? 'me' : ''} ${isHost ? 'host' : ''}">
                <div class="user-avatar">
                    <span class="avatar-initial">${member.displayName.charAt(0).toUpperCase()}</span>
                    ${isHost ? '<span class="host-badge">👑</span>' : ''}
                </div>
                <div class="user-info">
                    <div class="user-name">
                        ${member.displayName}${isMe ? ' (You)' : ''}${isHost ? ' (Host)' : ''}
                        ${multiplayerState.isHosting && !isMe && !isHost ? `
                            <button class="kick-btn" onclick="kickUser('${member.userId}')" title="Remove user">
                                ✕
                            </button>
                        ` : ''}
                    </div>
                    <div class="user-status">
                        ${hasLocation ? `<span class="status-online">📍 Active</span>` : '<span class="status-offline">💤 Idle</span>'}
                        <span class="last-update">${lastUpdateTime}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateHostUIElements() {
    const lockBtn = document.getElementById('lockLobbyBtn');
    const destBtn = document.getElementById('setDestBtn');
    const destPanel = document.getElementById('hostDestinationPanel');

    if (multiplayerState.isHosting) {
        console.log('[HOST] Showing host UI elements for:', multiplayerState.userId);
        if (lockBtn) lockBtn.style.display = 'block';
        if (destBtn) destBtn.style.display = 'block';
        if (destPanel) destPanel.style.display = 'block';
        
        // Populate destinations list
        populateDestinations();
        
        // Attach search listener
        setTimeout(() => {
            const searchInput = document.getElementById('destSearchInput');
            if (searchInput) {
                console.log('[HOST] Attaching destination search listener');
                searchInput.addEventListener('input', (e) => {
                    filterDestinations(e.target.value);
                });
            } else {
                console.warn('[HOST] Search input not found');
            }
        }, 50);
    } else {
        if (lockBtn) lockBtn.style.display = 'none';
        if (destBtn) destBtn.style.display = 'none';
        if (destPanel) destPanel.style.display = 'none';
    }
}

function populateDestinations() {
    const destList = document.getElementById('destinationsList');
    if (!destList) {
        console.warn('[DEST] Destinations list element not found');
        return;
    }

    const datalist = document.getElementById('destinationsDatalist');
    
    // Use current campus for interactive mode
    const campus = lobbyState.campus || 'main';
    const campusConfig = CAMPUS_CONFIG[campus];
    
    console.log('[DEST] Populating destinations for', campus, '- found', campusConfig?.locations?.length, 'locations');
    
    if (!campusConfig || !campusConfig.locations || campusConfig.locations.length === 0) {
        destList.innerHTML = '<small>No destinations available</small>';
        if (datalist) datalist.innerHTML = '';
        console.warn('[DEST] Campus config missing or no locations');
        return;
    }

    if (datalist) {
        datalist.innerHTML = campusConfig.locations
            .map(loc => `<option value="${String(loc.name).replace(/"/g, '&quot;')}"></option>`)
            .join('');
    }
    
    destList.innerHTML = campusConfig.locations.map((loc, idx) => {
        const escapedName = loc.name.replace(/'/g, "\\\\'");
        return `
        <div class="destination-item" onclick="selectDestination(this, '${escapedName}', ${loc.lat}, ${loc.lng})" style="cursor: pointer; transition: all 0.2s;">
            <div class="dest-icon">📍</div>
            <div class="dest-info">
                <div class="dest-name">${loc.name}</div>
                <div class="dest-coords"><small>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}</small></div>
            </div>
        </div>
    `;
    }).join('');
    
    console.log('[DEST] Destinations populated - click to select, then click START button');
}

function selectDestination(element, name, lat, lng) {
    // Remove selection from all items
    document.querySelectorAll('.destination-item').forEach(item => {
        item.classList.remove('selected');
        item.style.backgroundColor = 'transparent';
        item.style.borderLeft = 'none';
    });
    
    // Add selection to clicked item
    element.classList.add('selected');
    element.style.backgroundColor = 'rgba(255, 184, 0, 0.2)';
    element.style.borderLeft = '4px solid #FFB800';
    element.style.paddingLeft = '12px';

    const searchInput = document.getElementById('destSearchInput');
    if (searchInput) {
        searchInput.value = name;
    }
    
    // Hide all markers except destination, show destination marker
    hideNonDestinationMarkersAndShowDestination({ name, lat, lng });
}

// Hide all non-destination markers and only show the selected destination marker
function hideNonDestinationMarkersAndShowDestination(destination) {
    // Hide all other user markers
    for (const [userId, userData] of multiplayerState.otherUsers) {
        if (userData.marker) {
            userData.marker.setMap(null);
        }
        if (userData.labelOverlay) {
            userData.labelOverlay.setMap(null);
        }
    }
    
    // Hide current user marker and label
    if (multiplayerState.currentUserMarker) {
        multiplayerState.currentUserMarker.setMap(null);
    }
    if (multiplayerState.currentUserLabelOverlay) {
        multiplayerState.currentUserLabelOverlay.setMap(null);
    }
    
    // Clear previous destination marker
    if (multiplayerState.destinationMarker) {
        multiplayerState.destinationMarker.setMap(null);
        multiplayerState.destinationMarker = null;
    }
    
    // Create destination marker if map is ready
    if (lobbyState.map && destination) {
        multiplayerState.destinationMarker = new google.maps.Marker({
            position: { lat: destination.lat, lng: destination.lng },
            map: lobbyState.map,
            title: destination.name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#FF5722',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 3
            },
            zIndex: 1000
        });
        
        console.log('[DEST MARKER] Created destination marker for:', destination.name);
    }
    
    // Schedule restoration of user markers after a brief delay to let user see destination
    setTimeout(() => {
        restoreUserMarkersForMap();
    }, 300);
}

// Restore user markers on the map after they were hidden
function restoreUserMarkersForMap() {
    if (!lobbyState.map) return;

    console.log('[MARKERS] Restoring user markers to map');

    // Restore current user marker and label
    if (multiplayerState.currentUserMarker) {
        multiplayerState.currentUserMarker.setMap(lobbyState.map);
    }
    if (multiplayerState.currentUserLabelOverlay) {
        multiplayerState.currentUserLabelOverlay.setMap(lobbyState.map);
    }

    // Restore other users' markers and labels
    for (const [userId, userData] of multiplayerState.otherUsers) {
        if (userData.marker) {
            userData.marker.setMap(lobbyState.map);
        }
        if (userData.labelOverlay) {
            userData.labelOverlay.setMap(lobbyState.map);
        }
    }

    console.log('[MARKERS] User markers restored');
}

function filterDestinations(searchTerm) {
    const items = document.querySelectorAll('.destination-item');
    const term = searchTerm.toLowerCase();
    
    console.log('[SEARCH] Filtering', items.length, 'items by term:', searchTerm);
    
    let visibleCount = 0;
    items.forEach(item => {
        const name = item.querySelector('.dest-name').textContent.toLowerCase();
        const shouldShow = name.includes(term);
        item.style.display = shouldShow ? 'flex' : 'none';
        if (shouldShow) visibleCount++;
    });
    
    console.log('[SEARCH] Showing', visibleCount, 'results');
}

function updateSharedDestinationUI() {
    const destDisplay = document.getElementById('sharedDestDisplay');
    if (destDisplay) {
        if (multiplayerState.sharedDestination) {
            destDisplay.innerHTML = `
                <div class="destination-info">
                    <strong>${multiplayerState.sharedDestination.name}</strong><br>
                    <small>${multiplayerState.sharedDestination.lat.toFixed(4)}, ${multiplayerState.sharedDestination.lng.toFixed(4)}</small>
                </div>
            `;
        } else {
            destDisplay.innerHTML = '<small>No shared destination</small>';
        }
    }
}

// ============================================
// Map Markers for Other Users
// ============================================
function updateOtherUsersMarkers(members) {
    // Only update if we have the interactive lobby map active
    if (!lobbyState.map) {
        console.log('[MARKERS] Skipping - lobbyState.map not initialized yet');
        return;
    }

    const interactiveScreen = document.getElementById('interactive-screen');
    if (!interactiveScreen || !interactiveScreen.classList.contains('active')) {
        console.log('[MARKERS] Skipping - interactive screen not active');
        return;
    }

    console.log('[MARKERS] Updating markers for', members.length, 'members');

    // Remove users that are no longer in the room
    for (const [userId, userData] of multiplayerState.otherUsers) {
        if (!members.find(m => m.userId === userId)) {
            console.log('[MARKERS] Removing marker for', userData.displayName);
            if (userData.marker) {
                userData.marker.setMap(null);
            }
            // NEW: Remove label overlay
            if (userData.labelOverlay) {
                userData.labelOverlay.setMap(null);
            }
            if (userData.polyline) {
                userData.polyline.setMap(null);
            }
            multiplayerState.otherUsers.delete(userId);
        }
    }

    // Add or update markers for all other users
    members.forEach(member => {
        if (member.userId === multiplayerState.userId) {
            return; // Skip self
        }

        if (member.lat == null || member.lng == null) {
            return; // No location yet
        }

        let userData = multiplayerState.otherUsers.get(member.userId);

        if (!userData) {
            // Create new marker
            userData = {
                displayName: member.displayName,
                isHost: member.isHost,
                lat: member.lat,
                lng: member.lng,
                marker: null,
                labelOverlay: null,  // NEW: Store label overlay reference
                polyline: null,
                userRoute: null
            };

            const markerColor = member.isHost ? '#FFB800' : '#3B82F6'; // Gold for host, blue for others
            const marker = new google.maps.Marker({
                position: { lat: member.lat, lng: member.lng },
                map: lobbyState.map,
                title: member.displayName + (member.isHost ? ' (Host)' : ''),
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: markerColor,
                    fillOpacity: 0.9,
                    strokeColor: '#fff',
                    strokeWeight: 2
                },
                zIndex: 50
            });

            userData.marker = marker;

            // NEW: Create username label above marker
            userData.labelOverlay = createUserLabelOverlay(
                member.displayName,
                { lat: member.lat, lng: member.lng },
                lobbyState.map,
                false
            );

            multiplayerState.otherUsers.set(member.userId, userData);
        } else {
            // Update existing marker position
            userData.lat = member.lat;
            userData.lng = member.lng;
            userData.marker.setPosition({ lat: member.lat, lng: member.lng });

            // NEW: Update label position
            if (userData.labelOverlay) {
                userData.labelOverlay.updatePosition({ lat: member.lat, lng: member.lng });
            }
        }

        // NOTE: We do NOT generate routes for other users here.
        // Each client generates ONLY their own private route.
        // This keeps routes private — each user sees only their own.
    });
}

function updateCurrentUserMarker(currentUser) {
    if (!lobbyState.map || !currentUser.lat || !currentUser.lng) {
        return;
    }

    // Store current user marker if not exists
    if (!multiplayerState.currentUserMarker) {
        multiplayerState.currentUserMarker = new google.maps.Marker({
            position: { lat: currentUser.lat, lng: currentUser.lng },
            map: lobbyState.map,
            title: currentUser.displayName + ' (YOU)',
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: '#00FF00',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 3
            },
            zIndex: 100
        });

        // NEW: Create label overlay for current user
        multiplayerState.currentUserLabelOverlay = createUserLabelOverlay(
            currentUser.displayName,
            { lat: currentUser.lat, lng: currentUser.lng },
            lobbyState.map,
            true  // isCurrentUser = true
        );

        console.log('[SELF] Created marker and label for current user');
    } else {
        // Update position
        multiplayerState.currentUserMarker.setPosition({ lat: currentUser.lat, lng: currentUser.lng });

        // NEW: Update label position
        if (multiplayerState.currentUserLabelOverlay) {
            multiplayerState.currentUserLabelOverlay.updatePosition({ lat: currentUser.lat, lng: currentUser.lng });
        }
    }

    // Generate current user's private route to shared destination
    if (multiplayerState.sharedDestination) {
        generateAndDrawMyRoute(currentUser);
    }
}

function generateAndDrawUserRoute(member, userData, isCurrentUser = false) {
    console.warn('🟡 generateAndDrawUserRoute called for', isCurrentUser ? 'CURRENT' : member.displayName);
    
    // Validate all requirements
    if (!multiplayerState.sharedDestination) {
        console.error('  ❌ No destination');
        return;
    }
    if (!member.lat || !member.lng) {
        console.error('  ❌ No location');
        return;
    }
    if (!lobbyState.map) {
        console.error('  ❌ No map');
        return;
    }

    const start = { lat: member.lat, lng: member.lng };
    const end = multiplayerState.sharedDestination;

    // Create/initialize directions service
    if (!lobbyState.directionsService) {
        lobbyState.directionsService = new google.maps.DirectionsService();
    }

    // Request route  
    console.warn('  🚗 Requesting route...');
    const request = {
        origin: new google.maps.LatLng(start.lat, start.lng),
        destination: new google.maps.LatLng(end.lat, end.lng),
        travelMode: 'WALKING',
        avoidTolls: false
    };

    lobbyState.directionsService.route(request, (result, status) => {
        console.warn('  📡 API response:', status);
        
        if (status !== 'OK' || !result || !result.routes || result.routes.length === 0) {
            console.error('  ❌ Route failed:', status);
            return;
        }

        const path = result.routes[0].overview_path;
        console.warn('  ✅ Got path:', path.length, 'points');

        if (isCurrentUser) {
            if (multiplayerState.currentUserPolyline) {
                multiplayerState.currentUserPolyline.setMap(null);
            }
            console.warn('  🟢 Drawing GREEN polyline (CURRENT USER)');
            multiplayerState.currentUserPolyline = new google.maps.Polyline({
                path: path,
                geodesic: true,
                strokeColor: '#00FF00',
                strokeOpacity: 1.0,
                strokeWeight: 8,
                map: lobbyState.map,
                zIndex: 1000
            });
            multiplayerState.currentUserRoute = result.routes[0];
            console.warn('  ✅✅✅ GREEN LINE DRAWN ✅✅✅');
        } else {
            if (userData.polyline) {
                userData.polyline.setMap(null);
            }
            const color = member.isHost ? '#FFB800' : '#3B82F6';
            const colorName = member.isHost ? 'GOLD' : 'BLUE';
            console.warn('  ' + (member.isHost ? '🟡' : '🔵'), 'Drawing', colorName, 'polyline');
            userData.polyline = new google.maps.Polyline({
                path: path,
                geodesic: true,
                strokeColor: color,
                strokeOpacity: 1.0,
                strokeWeight: 6,
                map: lobbyState.map,
                zIndex: 999
            });
            userData.userRoute = result.routes[0];
            console.warn('  ✅ ' + colorName + ' LINE DRAWN');
        }
    });
}

function regenerateAllRoutes() {
    console.warn('🔴 regenerateAllRoutes CALLED');
    console.warn('  Destination?', !!multiplayerState.sharedDestination);
    console.warn('  Map ready?', !!lobbyState.map);

    if (!multiplayerState.sharedDestination) {
        console.warn('🔴 NO DESTINATION - STOPPING');
        return;
    }
    if (!lobbyState.map) {
        console.error('🔴 MAP NOT INITIALIZED - BLOCKING');
        return;
    }

    // ── PRIVATE ROUTES ──────────────────────────────────────────────
    // Each user only generates and sees their OWN route.
    // We never draw routes for other members; those are handled
    // on each member's own device.
    // ────────────────────────────────────────────────────────────────

    // Try to get current user's location from roomMembers first
    let currentUser = multiplayerState.roomMembers.find(
        m => m.userId === multiplayerState.userId
    );

    // Fallback: use lastLocation if roomMembers entry has no coords yet
    if (currentUser && (!currentUser.lat || !currentUser.lng) && multiplayerState.lastLocation.lat) {
        console.warn('  ⚠️ Using lastLocation fallback for current user coords');
        currentUser = {
            ...currentUser,
            lat: multiplayerState.lastLocation.lat,
            lng: multiplayerState.lastLocation.lng
        };
    }

    // Also accept raw lastLocation when roomMembers hasn't updated yet
    if (!currentUser && multiplayerState.lastLocation.lat) {
        currentUser = {
            userId: multiplayerState.userId,
            displayName: state.user || 'Me',
            isHost: multiplayerState.isHosting,
            lat: multiplayerState.lastLocation.lat,
            lng: multiplayerState.lastLocation.lng
        };
    }

    if (currentUser && currentUser.lat && currentUser.lng) {
        console.warn('  → Drawing MY private route');
        generateAndDrawMyRoute(currentUser);
    } else {
        console.error('🔴 CURRENT USER HAS NO LOCATION — cannot draw route yet');
    }
}

/**
 * Generates and draws the current user's private route to the shared destination.
 * This route is ONLY drawn on the current user's device — other members never see it.
 * Uses EXACT SAME logic as solo mode startNavigation function.
 *
 * @param {Object} currentUser - { lat, lng, displayName, isHost }
 */
function generateAndDrawMyRoute(currentUser) {
    if (!multiplayerState.sharedDestination || !lobbyState.map) {
        console.warn('[MY ROUTE] Cannot generate - no destination or map');
        return;
    }

    const target = multiplayerState.sharedDestination;
    let startLat = currentUser.lat;
    let startLng = currentUser.lng;

    // Check if user is inside campus
    let userOutsideCampus = !isInsideCampusInteractive(startLat, startLng);
    let nearestGate = null;

    // Heuristic: if near a gate but far from any walkable route point, force gate-entry routing
    try {
        const campus = lobbyState.campus || 'main';
        const gates = CAMPUS_GATES[campus] || [];
        let nearestGateDist = Infinity;
        gates.forEach(g => {
            const d = haversine(startLat, startLng, g.lat, g.lng);
            if (d < nearestGateDist) nearestGateDist = d;
        });

        let nearestRouteDist = Infinity;
        if (Array.isArray(lobbyState.campusRouteCoords) && lobbyState.campusRouteCoords.length > 0) {
            lobbyState.campusRouteCoords.forEach(coord => {
                const d = haversine(startLat, startLng, coord.lat, coord.lng);
                if (d < nearestRouteDist) nearestRouteDist = d;
            });
        }

        if (!userOutsideCampus && nearestGateDist <= 35 && nearestRouteDist >= 55) {
            console.log('[ROUTING] Gate-entry heuristic triggered:', { nearestGateDist, nearestRouteDist });
            userOutsideCampus = true;
        }
    } catch (e) {
        console.warn('[ROUTING] Gate-entry heuristic error:', e);
    }

    // If user is outside campus, route them to nearest gate first
    if (userOutsideCampus) {
        nearestGate = findNearestGateInteractive(startLat, startLng);
        if (nearestGate) {
            // Use Google Directions API for real route from user to gate
            const directionsService = new window.google.maps.DirectionsService();
            directionsService.route({
                origin: { lat: startLat, lng: startLng },
                destination: { lat: nearestGate.lat, lng: nearestGate.lng },
                travelMode: window.google.maps.TravelMode.WALKING,
                provideRouteAlternatives: false
            }, (result, status) => {
                if (status === window.google.maps.DirectionsStatus.OK && result.routes && result.routes.length > 0) {
                    // Remove previous outside polyline if any
                    if (multiplayerState.outsideRoutePolyline) multiplayerState.outsideRoutePolyline.setMap(null);
                    // Draw the outside-campus route as a blue polyline
                    multiplayerState.outsideRoutePolyline = new window.google.maps.Polyline({
                        path: result.routes[0].overview_path.map(latlng => ({ lat: latlng.lat(), lng: latlng.lng() })),
                        geodesic: true,
                        strokeColor: '#1976D2',
                        strokeOpacity: 1.0,
                        strokeWeight: 10,
                        icons: [{
                            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4 },
                            offset: '0',
                            repeat: '20px'
                        }],
                        map: lobbyState.map
                    });
                } else {
                    // Fallback: draw straight line if Directions API fails
                    if (multiplayerState.outsideRoutePolyline) multiplayerState.outsideRoutePolyline.setMap(null);
                    multiplayerState.outsideRoutePolyline = new window.google.maps.Polyline({
                        path: [
                            { lat: startLat, lng: startLng },
                            { lat: nearestGate.lat, lng: nearestGate.lng }
                        ],
                        geodesic: true,
                        strokeColor: '#1976D2',
                        strokeOpacity: 1.0,
                        strokeWeight: 10,
                        icons: [{
                            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4 },
                            offset: '0',
                            repeat: '20px'
                        }],
                        map: lobbyState.map
                    });
                }
            });
            // Start campus route from the gate
            startLat = nearestGate.lat;
            startLng = nearestGate.lng;
            showNotification(`Routing to ${nearestGate.name} first`, 'info');
        }
    }

    // Clear route graph check
    if (!lobbyState.routeGraph || !lobbyState.campusRouteCoords) {
        console.error('[ROUTING] Route graph not initialized!');
        showNotification('Map data not ready', 'error');
        return;
    }

    console.log('[ROUTING] Starting navigation to:', target.name);
    console.log('[ROUTING] Campus route coords:', lobbyState.campusRouteCoords.length, 'points');
    console.log('[ROUTING] Route graph nodes:', Object.keys(lobbyState.routeGraph || {}).length);

    // Get candidate nodes (SOLO MODE STYLE, but interactive always uses main campus)
    const USER_MAX_DISTANCE = 100; // Allow user to be up to 100m from route
    const destIsInsideCampus = isInsideCampusInteractive(target.lat, target.lng);
    const isDormDestination = (target && target.name) ? target.name.toUpperCase().includes('DORM') : false;
    const isBackGateDestination = (target && target.name) ? target.name.toUpperCase().includes('BACK GATE') : false;
    // Interactive mode always uses main campus, so use more flexible distance thresholds
    const DEST_MAX_DISTANCE = isDormDestination ? 250 : (destIsInsideCampus ? 200 : 100);

    let userNodeCandidates, destNodeCandidates;

    if (userOutsideCampus && nearestGate) {
        userNodeCandidates = findClosestRoutePointRobust(nearestGate.lat, nearestGate.lng, lobbyState.campusRouteCoords, USER_MAX_DISTANCE);
        console.log('[ROUTING] User outside - trying gate nodes:', userNodeCandidates);
    } else {
        userNodeCandidates = findClosestRoutePointRobust(startLat, startLng, lobbyState.campusRouteCoords, USER_MAX_DISTANCE);
        console.log('[ROUTING] User inside - trying nodes:', userNodeCandidates);
    }

    destNodeCandidates = findClosestRoutePointRobust(target.lat, target.lng, lobbyState.campusRouteCoords, DEST_MAX_DISTANCE);
    console.log('[ROUTING] Destination candidates:', destNodeCandidates);

    // Check if destination is reachable (has route connection points)
    if (!destNodeCandidates || destNodeCandidates.length === 0) {
        const destIsOutside = !isInsideCampusInteractive(target.lat, target.lng);
        
        // Restore UI state: show user markers again since route generation failed
        restoreUserMarkersForMap();

        if (destIsOutside) {
            const nearestGateToDest = findNearestGateInteractive(target.lat, target.lng);
            if (nearestGateToDest) {
                console.log('[ROUTING] Destination outside campus, routing to nearest gate:', nearestGateToDest.name);
                showNotification(`${target.name} is outside campus. Routing to nearest gate: ${nearestGateToDest.name}`, 'info');
                const gateDestination = {
                    name: nearestGateToDest.name,
                    lat: nearestGateToDest.lat,
                    lng: nearestGateToDest.lng
                };
                multiplayerState.sharedDestination = gateDestination;
                return generateAndDrawMyRoute(currentUser);
            }
        } else {
            const nearestGateToDest = findNearestGateInteractive(target.lat, target.lng);
            if (nearestGateToDest) {
                console.log('[ROUTING] Destination inside campus but not directly reachable, routing to nearest gate:', nearestGateToDest.name);
                showNotification(`Can't reach ${target.name} directly. Routing to nearest gate: ${nearestGateToDest.name}`, 'info');
                const gateDestination = {
                    name: nearestGateToDest.name,
                    lat: nearestGateToDest.lat,
                    lng: nearestGateToDest.lng
                };
                multiplayerState.sharedDestination = gateDestination;
                return generateAndDrawMyRoute(currentUser);
            } else {
                showNotification(`Cannot reach ${target.name}. No alternative routes available.`, 'error');
                return;
            }
        }
    }

    // Check if user location is reachable
    if (!userNodeCandidates || userNodeCandidates.length === 0) {
        let actualClosest = Infinity;
        lobbyState.campusRouteCoords.forEach(coord => {
            const d = haversine(startLat, startLng, coord.lat, coord.lng);
            if (d < actualClosest) actualClosest = d;
        });
        console.error('[ROUTING] User location not reachable via walkable routes:', {
            closestRouteDistance: actualClosest.toFixed(2) + 'm',
            maxAllowed: USER_MAX_DISTANCE + 'm'
        });
        showNotification('Your location is not reachable via walkable routes. Please move closer to a path.', 'error');
        return;
    }

    // Use ONLY the closest candidates (SOLO MODE STYLE - NOT all combinations)
    let userNodeIdx = userNodeCandidates[0]; // Closest user location to any route node
    let destNodeIdx = destNodeCandidates[0]; // Closest destination to any route node

    console.log('[ROUTING] Using closest candidates: User node', userNodeIdx, '@ route point', lobbyState.campusRouteCoords[userNodeIdx]);
    console.log('[ROUTING] Using closest candidates: Dest node', destNodeIdx, '@ route point', lobbyState.campusRouteCoords[destNodeIdx]);

    // Run Dijkstra with the closest candidates
    let pathNodeIndices = dijkstra(lobbyState.routeGraph, userNodeIdx, destNodeIdx);

    if (!pathNodeIndices || pathNodeIndices.length === 0) {
        console.error('[ROUTING] Route generation failed - no walkable path found');
        showNotification('No walkable route found to this destination. Please try another location.', 'error');
        return;
    }

    // Simplify path to ensure SINGLE route without loops or branches
    console.log('[ROUTING] Path before simplification:', pathNodeIndices.slice(0, 5).map(idx => `idx:${idx}`).join(' -> '),
                '...', pathNodeIndices.slice(-3).map(idx => `idx:${idx}`).join(' -> '));
    pathNodeIndices = simplifyPath(pathNodeIndices, lobbyState.campusRouteCoords);
    console.log('[ROUTING] Simplified path has', pathNodeIndices.length, 'nodes');

    // Build complete path: ONLY use defined walkable routes
    let currentPath = [];
    const routeCoords = pathNodeIndices.map(idx => lobbyState.campusRouteCoords[idx]);

    // Start with user location (or gate if outside) - but only if it's not already on the route
    const startRoutePoint = routeCoords[0];
    const userToRouteStartDist = haversine(
        startLat, startLng,
        startRoutePoint.lat, startRoutePoint.lng
    );

    if (userOutsideCampus && nearestGate) {
        currentPath.push({ lat: startLat, lng: startLng });
        currentPath.push({ lat: nearestGate.lat, lng: nearestGate.lng });
    }

    // Add the route path (ONLY defined walkable routes)
    routeCoords.forEach(coord => {
        currentPath.push(coord);
    });

    // Add final destination segment
    const endRoutePoint = routeCoords[routeCoords.length - 1];
    const routeEndToDestDist = haversine(
        endRoutePoint.lat, endRoutePoint.lng,
        target.lat, target.lng
    );
    if (routeEndToDestDist > 0.1) {
        currentPath.push({ lat: target.lat, lng: target.lng });
        console.log('[ROUTING] Added final destination segment:', routeEndToDestDist.toFixed(2), 'm from last route point');
    }

    // Remove duplicate consecutive coordinates and detect U-turns
    const cleanPath = [];
    for (let i = 0; i < currentPath.length; i++) {
        if (i > 0 &&
            currentPath[i].lat === currentPath[i - 1].lat &&
            currentPath[i].lng === currentPath[i - 1].lng) {
            continue;
        }

        if (i >= 2) {
            const prev = currentPath[i - 1];
            const prevPrev = currentPath[i - 2];
            const current = currentPath[i];

            const distToPrevPrev = haversine(current.lat, current.lng, prevPrev.lat, prevPrev.lng);
            if (distToPrevPrev < 3) {
                console.log(`[ROUTING] Detected U-turn at index ${i}, removing intermediate point`);
                cleanPath.pop();
                continue;
            }
        }

        cleanPath.push(currentPath[i]);
    }

    multiplayerState.currentUserRoute = cleanPath;

    // Calculate total distance
    let totalDistance = 0;
    for (let i = 0; i < multiplayerState.currentUserRoute.length - 1; i++) {
        totalDistance += haversine(
            multiplayerState.currentUserRoute[i].lat, multiplayerState.currentUserRoute[i].lng,
            multiplayerState.currentUserRoute[i + 1].lat, multiplayerState.currentUserRoute[i + 1].lng
        );
    }
    console.log('[ROUTING] Total route distance: ' + totalDistance.toFixed(2) + ' meters');

    // Clear previous route polyline
    if (multiplayerState.currentUserPolyline) {
        multiplayerState.currentUserPolyline.setMap(null);
        multiplayerState.currentUserPolyline = null;
    }

    stopInteractiveRouteArrowAnimation();

    // Draw route polyline (green for navigation) - SINGLE ROUTE ONLY
    multiplayerState.currentUserPolyline = new window.google.maps.Polyline({
        path: multiplayerState.currentUserRoute,
        geodesic: true,
        strokeColor: '#ADFF2F',
        strokeOpacity: 0.6,
        strokeWeight: 5,
        zIndex: 100,
        map: lobbyState.map
    });

    console.log('[ROUTING] Polyline drawn with', multiplayerState.currentUserRoute.length, 'points to destination:', target.name);

    // Start route arrow animation (EXACT SAME AS SOLO MODE)
    startInteractiveRouteArrowAnimation();

    // Style walkable routes for interactive mode
    styleWalkableRoutesForInteractive();

    // Show notification with distance and time
    const durationMin = Math.ceil(totalDistance / 80); // ~80m/min walking speed
    showNotification(`🗺️ Route to ${target.name}: ${Math.round(totalDistance)}m · ~${durationMin} min walk`, 'success');

    console.log('[ROUTING] ✅ Route generation complete');
}

// Style walkable routes as transparent white for interactive mode (for better visibility with animated arrows)
function styleWalkableRoutesForInteractive() {
    if (lobbyState.walkableRoutePolylines && lobbyState.walkableRoutePolylines.length > 0) {
        lobbyState.walkableRoutePolylines.forEach(pl => {
            if (!pl) return;
            pl.setOptions({
                strokeColor: '#FFFFFF',
                strokeOpacity: 0.15,
                strokeWeight: 3
            });
        });
        console.log('[WALKABLE ROUTES] Styled as transparent white for interactive navigation');
    }
}

// Restore walkable routes styling for interactive mode
function restoreWalkableRoutesStyling() {
    if (lobbyState.walkableRoutePolylines && lobbyState.walkableRoutePolylines.length > 0) {
        lobbyState.walkableRoutePolylines.forEach(pl => {
            if (!pl) return;
            pl.setOptions({
                strokeColor: '#2196F3',
                strokeOpacity: 0.9,
                strokeWeight: 5
            });
        });
        console.log('[WALKABLE ROUTES] Restored to normal styling');
    }
}

// Start route arrow animation for interactive mode (EXACT SAME AS SOLO MODE)
function startInteractiveRouteArrowAnimation() {
    if (!multiplayerState.currentUserPolyline || !window.google || !window.google.maps) return;

    stopInteractiveRouteArrowAnimation();

    const arrowSymbol = {
        path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 4,
        strokeColor: '#FFFFFF',
        strokeOpacity: 1,
        fillColor: '#FFFFFF',
        fillOpacity: 1
    };

    let offset = 0;
    const repeat = '80px';
    const polyline = multiplayerState.currentUserPolyline;

    polyline.setOptions({
        strokeColor: '#ADFF2F',
        strokeOpacity: 0.6,  // Reduced opacity to make arrows stand out
        strokeWeight: 5,  // Reduced weight to make arrows more visible
        icons: [{
            icon: arrowSymbol,
            offset: '0px',
            repeat: repeat
        }]
    });

    multiplayerState.routeAnimationInterval = setInterval(() => {
        offset = (offset + 2) % 80;
        polyline.set('icons', [{
            icon: arrowSymbol,
            offset: `${offset}px`,
            repeat: repeat
        }]);
    }, 20);

    console.log('[ANIMATION] Route arrow animation started');
}

// Stop route arrow animation for interactive mode
function stopInteractiveRouteArrowAnimation() {
    if (multiplayerState.routeAnimationInterval) {
        clearInterval(multiplayerState.routeAnimationInterval);
        multiplayerState.routeAnimationInterval = null;
    }

    if (multiplayerState.currentUserPolyline) {
        multiplayerState.currentUserPolyline.set('icons', []);
        multiplayerState.currentUserPolyline.setOptions({
            strokeColor: '#ADFF2F',
            strokeOpacity: 0.6,
            strokeWeight: 5
        });
    }
    
    console.log('[ANIMATION] Route arrow animation stopped');
}

function clearOtherUsersMarkers() {
    for (const [userId, userData] of multiplayerState.otherUsers) {
        if (userData.marker) {
            userData.marker.setMap(null);
        }
        // NEW: Clear label overlay
        if (userData.labelOverlay) {
            userData.labelOverlay.setMap(null);
        }
        if (userData.polyline) {
            userData.polyline.setMap(null);
        }
    }
    multiplayerState.otherUsers.clear();

    // Clear current user
    if (multiplayerState.currentUserMarker) {
        multiplayerState.currentUserMarker.setMap(null);
        multiplayerState.currentUserMarker = null;
    }
    // NEW: Clear current user label
    if (multiplayerState.currentUserLabelOverlay) {
        multiplayerState.currentUserLabelOverlay.setMap(null);
        multiplayerState.currentUserLabelOverlay = null;
    }
    
    // Clear current user route and animation
    if (multiplayerState.currentUserPolyline) {
        multiplayerState.currentUserPolyline.setMap(null);
        multiplayerState.currentUserPolyline = null;
    }
    multiplayerState.currentUserRoute = null;
    
    // Clear route animation
    stopInteractiveRouteArrowAnimation();
    
    // Restore walkable routes styling
    restoreWalkableRoutesStyling();
    
    // Clear destination marker
    if (multiplayerState.destinationMarker) {
        multiplayerState.destinationMarker.setMap(null);
        multiplayerState.destinationMarker = null;
    }
}

// ============================================
// Distance & ETA Notifications (Every 20 seconds)
// ============================================
function startDistanceNotifications() {
    // Clear any existing interval
    stopDistanceNotifications();

    console.log('[DISTANCE] Starting periodic distance/ETA notifications');

    // Send initial notification immediately
    broadcastDistanceAndETA();

    // Then repeat every 20 seconds
    multiplayerState.distanceUpdateInterval = setInterval(() => {
        broadcastDistanceAndETA();
    }, 20000);
}

function stopDistanceNotifications() {
    if (multiplayerState.distanceUpdateInterval) {
        clearInterval(multiplayerState.distanceUpdateInterval);
        multiplayerState.distanceUpdateInterval = null;
        console.log('[DISTANCE] Distance notifications stopped');
    }
}

function broadcastDistanceAndETA() {
    if (!multiplayerState.sharedDestination || !multiplayerState.roomMembers || multiplayerState.roomMembers.length === 0) {
        console.log('[DISTANCE] Skipping broadcast - no destination or room members');
        return;
    }

    const destination = multiplayerState.sharedDestination;
    const WALKING_SPEED = 80; // meters per minute

    // Haversine formula to calculate distance between two points
    function calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in meters
    }

    // Build message with all users' distances and ETAs
    let userDistances = [];
    
    for (const member of multiplayerState.roomMembers) {
        if (member.lat && member.lng && destination.lat && destination.lng) {
            const distanceMeters = calculateDistance(member.lat, member.lng, destination.lat, destination.lng);
            const minutes = Math.ceil(distanceMeters / WALKING_SPEED);
            
            const marker = member.isHost ? '👑' : '👤';
            userDistances.push({
                name: member.displayName,
                distance: distanceMeters,
                minutes: minutes,
                marker: marker
            });
        }
    }

    // Sort by distance (closest first)
    userDistances.sort((a, b) => a.distance - b.distance);

    // Format ultra-compact message for chat
    if (userDistances.length > 0) {
        // Build compact single-line message
        const userStatusList = userDistances.map(user => {
            const distStr = user.distance < 1000 
                ? `${Math.round(user.distance)}m` 
                : `${(user.distance / 1000).toFixed(1)}km`;
            return `${user.marker}${user.name.split(' ')[0]}: ${distStr}`;
        }).join(' • ');

        const messageText = `🧭 ${userStatusList}`;

        // Send as system message via socket
        if (multiplayerState.socket && multiplayerState.isInLobby && multiplayerState.roomCode) {
            console.log('[DISTANCE] Broadcasting: ' + messageText);
            multiplayerState.socket.emit('send_message', {
                roomCode: multiplayerState.roomCode,
                message: messageText,
                displayName: '📍 Navigation',
                userId: 'system',
                isSystemMessage: true,
                timestamp: Date.now()
            }, (response) => {
                if (response?.success) {
                    console.log('[DISTANCE] Update sent');
                } else {
                    console.error('[DISTANCE] Failed:', response?.error);
                }
            });
        }
    }
}

// ============================================
// Chat Functionality
// ============================================
function sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input || !input.value.trim()) return;

    const message = input.value.trim();
    if (!multiplayerState.socket || !multiplayerState.isInLobby) {
        console.error('[CHAT] Not connected to lobby');
        return;
    }

    // Send message via socket
    multiplayerState.socket.emit('send_message', {
        roomCode: multiplayerState.roomCode,
        message: message,
        displayName: state.user || 'User',
        userId: multiplayerState.userId
    }, (response) => {
        if (response.success) {
            console.log('[CHAT] Message sent successfully');
        } else {
            console.error('[CHAT] Failed to send message:', response.error);
        }
    });

    input.value = '';
}

function displayChatMessage(messageData) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    if (messageData.userId === multiplayerState.userId) {
        messageElement.classList.add('user-message');
    } else if (messageData.isSystemMessage) {
        messageElement.classList.add('system-message');
    } else {
        messageElement.classList.add('other-message');
    }

    const timestamp = new Date(messageData.timestamp || Date.now()).toLocaleTimeString();
    
    // Format message text - preserve newlines for system messages
    let messageText = escapeHtml(messageData.message);
    if (messageData.isSystemMessage) {
        messageText = messageText.replace(/\n/g, '<br>');
    }
    
    messageElement.innerHTML = `
        <div class="message-sender">${messageData.displayName}</div>
        <div class="message-text">${messageText}</div>
        <div class="message-time">${timestamp}</div>
    `;

    chatMessages.appendChild(messageElement);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// ============================================
// Export for HTML event handlers
// ============================================
window.createLobby = createLobby;
window.joinLobby = joinLobby;
window.leaveLobby = leaveLobby;
window.showJoinLobbyModal = showJoinLobbyModal;
window.closeJoinLobbyModal = closeJoinLobbyModal;
window.copyLobbyCode = copyLobbyCode;
window.toggleLocationSharing = toggleLocationSharing;
window.kickUser = kickUser;
window.lockLobby = lockLobby;
window.setSharedDestination = setSharedDestination;
window.selectDestination = selectDestination;
window.sendMessage = sendMessage;
window.populateDestinations = populateDestinations;
window.filterDestinations = filterDestinations;
window.regenerateAllRoutes = regenerateAllRoutes;
window.generateAndDrawMyRoute = generateAndDrawMyRoute;
window.restoreUserMarkersForMap = restoreUserMarkersForMap;
window.startDistanceNotifications = startDistanceNotifications;
window.stopDistanceNotifications = stopDistanceNotifications;
window.broadcastDistanceAndETA = broadcastDistanceAndETA;

// ============================================
// START BUTTON FOR LOBBY
// ============================================
function startLobbyNavigation() {
    if (!multiplayerState.isHosting) {
        if (typeof showNotification === 'function') {
            showNotification('Only the host can start navigation!', 'warning', 5000);
        }
        return;
    }

    // Get list of destinations for current campus
    const campus = lobbyState.campus || 'main';
    const campusConfig = CAMPUS_CONFIG[campus];
    if (!campusConfig || !campusConfig.locations) {
        if (typeof showNotification === 'function') {
            showNotification('No destinations available', 'error', 6000);
        }
        return;
    }

    const destinationsList = document.getElementById('destinationsList');
    const searchInput = document.getElementById('destSearchInput');

    let destination = null;

    const selectedItem = destinationsList ? destinationsList.querySelector('.destination-item.selected') : null;
    if (selectedItem) {
        const nameEl = selectedItem.querySelector('.dest-name');
        const name = nameEl ? nameEl.textContent : '';
        destination = campusConfig.locations.find(loc => loc.name === name);
    }

    if (!destination && searchInput) {
        const typed = (searchInput.value || '').trim();
        if (typed) {
            destination = campusConfig.locations.find(loc => String(loc.name).toLowerCase() === typed.toLowerCase());
        }
    }

    if (!destination) {
        if (typeof showNotification === 'function') {
            showNotification('Select a destination from the dropdown first!', 'warning', 5000);
        }
        return;
    }

    console.warn('🟢 START clicked - triggering navigation');
    setSharedDestination({
        name: destination.name,
        lat: destination.lat,
        lng: destination.lng
    });
}

// ===== Window exports =====
window.startLobbyNavigation = startLobbyNavigation;

// ===== Attach START button handler =====
setTimeout(() => {
    const startBtn = document.getElementById('startLobbyNavBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startLobbyNavigation);
    }
    
    const searchInput = document.getElementById('destSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterDestinations(e.target.value);
        });
    }
}, 100);

// ===== Styled Confirmation Dialog =====
function showConfirmationDialog(title, message, onConfirm) {
    const overlay = document.getElementById('confirmationDialog');
    if (!overlay) return;

    // Set title and message
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;

    // Show overlay
    overlay.classList.add('active');

    // Handler functions
    const handleConfirm = () => {
        overlay.classList.remove('active');
        removeEventListeners();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    };

    const handleCancel = () => {
        overlay.classList.remove('active');
        removeEventListeners();
    };

    const removeEventListeners = () => {
        document.getElementById('confirmOK').removeEventListener('click', handleConfirm);
        document.getElementById('confirmCancel').removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleBackdropClick);
    };

    const handleBackdropClick = (e) => {
        if (e.target === overlay) {
            handleCancel();
        }
    };

    // Attach listeners
    document.getElementById('confirmOK').addEventListener('click', handleConfirm);
    document.getElementById('confirmCancel').addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleBackdropClick);
}

console.log('[MULTIPLAYER] Interactive client loaded');
