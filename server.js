// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active rooms
const rooms = new Map();

// Room class
class Room {
    constructor(id) {
        this.id = id;
        this.users = new Map();
        this.messages = [];
        this.userCounter = 0;
    }

    addUser(ws, userId) {
        if (this.users.size >= 4) {
            return false; // Room full
        }
        
        this.userCounter++;
        const userNumber = this.userCounter;
        
        this.users.set(userId, {
            ws,
            userId,
            userNumber,
            joinedAt: new Date()
        });
        
        // Send user their info
        ws.send(JSON.stringify({
            type: 'joined',
            userId,
            userNumber,
            roomId: this.id
        }));
        
        // Send existing messages
        ws.send(JSON.stringify({
            type: 'messages',
            messages: this.messages
        }));
        
        // Broadcast user count update
        this.broadcastUserCount();
        
        // Broadcast join message
        this.broadcast({
            type: 'user_joined',
            userNumber
        });
        
        return true;
    }

    removeUser(userId) {
        const user = this.users.get(userId);
        if (user) {
            this.users.delete(userId);
            this.broadcastUserCount();
            this.broadcast({
                type: 'user_left',
                userNumber: user.userNumber
            });
        }
        
        // Clean up empty rooms
        if (this.users.size === 0) {
            rooms.delete(this.id);
        }
    }

    broadcastMessage(message) {
        this.messages.push(message);
        
        // Keep only last 100 messages
        if (this.messages.length > 100) {
            this.messages.shift();
        }
        
        this.broadcast({
            type: 'message',
            message
        });
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        this.users.forEach(user => {
            if (user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(message);
            }
        });
    }

    broadcastUserCount() {
        this.broadcast({
            type: 'user_count',
            count: this.users.size
        });
    }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    let currentRoom = null;
    let currentUserId = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join':
                    const { roomId, userId } = data;
                    
                    // Create room if doesn't exist
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, new Room(roomId));
                    }
                    
                    const room = rooms.get(roomId);
                    const joined = room.addUser(ws, userId);
                    
                    if (joined) {
                        currentRoom = room;
                        currentUserId = userId;
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Room is full (max 4 users)'
                        }));
                        ws.close();
                    }
                    break;
                    
                case 'message':
                    if (currentRoom && currentUserId) {
                        const user = currentRoom.users.get(currentUserId);
                        if (user) {
                            currentRoom.broadcastMessage({
                                id: Date.now(),
                                userId: currentUserId,
                                userNumber: user.userNumber,
                                encrypted: data.encrypted,
                                timestamp: new Date()
                            });
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('WebSocket error:', error);
        }
    });
    
    ws.on('close', () => {
        if (currentRoom && currentUserId) {
            currentRoom.removeUser(currentUserId);
        }
    });
});

// Serve static files
app.use(express.static('public'));

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        rooms: rooms.size,
        connections: wss.clients.size
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Clean up old messages periodically (every hour)
setInterval(() => {
    rooms.forEach(room => {
        if (room.messages.length > 50) {
            room.messages = room.messages.slice(-50);
        }
    });
}, 60 * 60 * 1000);