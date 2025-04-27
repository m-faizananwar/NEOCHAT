const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Create server first
const server = http.createServer(app);

// Then initialize Socket.io with the server
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Session store
const pgSession = require('connect-pg-simple')(session);
const sessionMiddleware = session({
    store: new pgSession({
        pool: pool,
        tableName: 'user_sessions'
    }),
    secret: process.env.SESSION_SECRET || 'chat_app_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
});

// Middleware for JSON parsing and session management
app.use(express.json());
app.use(sessionMiddleware);

// Create required database tables
async function initializeDatabase() {
    try {
        // Users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add columns if they don't exist
        try {
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`);
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
        } catch (err) {
            console.log('Note: Column additions might not be supported in your PostgreSQL version');
        }
        
        // Messages table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(255) NOT NULL,
                recipient VARCHAR(255),
                message TEXT NOT NULL,
                chat_type VARCHAR(50) NOT NULL DEFAULT 'direct',
                chat_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Group chats table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS group_chats (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                creator VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Group members table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS group_members (
                id SERIAL PRIMARY KEY,
                group_id INTEGER REFERENCES group_chats(id) ON DELETE CASCADE,
                username VARCHAR(255) NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, username)
            )
        `);
        
        // Sessions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                sid VARCHAR NOT NULL PRIMARY KEY,
                sess JSON NOT NULL,
                expire TIMESTAMP(6) NOT NULL
            )
        `);
        
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

initializeDatabase();

// Share session data with Socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// Authentication middleware
function checkAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Authentication routes
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Check if username already exists
        const userExists = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Hash password and create user
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username, passwordHash]
        );
        
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Find user
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Set session data
        req.session.userId = user.id;
        req.session.username = user.username;
        
        res.json({ message: 'Login successful', username: user.username });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ message: 'Logged out successfully' });
    });
});

app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.userId) {
        return res.json({ authenticated: true, username: req.session.username });
    }
    return res.status(401).json({ authenticated: false });
});

// Protected API routes
app.get('/api/users', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, display_name, avatar_url FROM users');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/groups', checkAuth, async (req, res) => {
    try {
        const username = req.session.username;
        const result = await pool.query(`
            SELECT g.id, g.name, g.creator, g.created_at
            FROM group_chats g
            JOIN group_members m ON g.id = m.group_id
            WHERE m.username = $1
        `, [username]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

app.post('/api/groups', checkAuth, async (req, res) => {
    try {
        const { name, members, creator } = req.body;
        const username = req.session.username;
        
        // Start transaction
        await pool.query('BEGIN');
        
        // Create group
        const groupResult = await pool.query(
            'INSERT INTO group_chats (name, creator) VALUES ($1, $2) RETURNING id',
            [name, username]
        );
        
        const groupId = groupResult.rows[0].id;
        
        // Add creator as a member
        await pool.query(
            'INSERT INTO group_members (group_id, username) VALUES ($1, $2)',
            [groupId, username]
        );
        
        // Add members to group
        for (const memberId of members) {
            const memberResult = await pool.query('SELECT username FROM users WHERE id = $1', [memberId]);
            if (memberResult.rows.length > 0) {
                const memberUsername = memberResult.rows[0].username;
                await pool.query(
                    'INSERT INTO group_members (group_id, username) VALUES ($1, $2)',
                    [groupId, memberUsername]
                );
            }
        }
        
        await pool.query('COMMIT');
        
        res.status(201).json({ 
            id: groupId,
            name,
            creator: username
        });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

// Protect the main page
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Main page redirects to login if not authenticated
app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.redirect('/login.html');
    }
});

// Track online users
let onlineUsers = new Map(); // Maps socket ID to username

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    // User connects with authentication
    socket.on('user-connected', async (data) => {
        const { username } = data;
        
        // Store online user
        onlineUsers.set(socket.id, username);
        
        // Broadcast online users list
        broadcastOnlineUsers();
    });
    
    // Join a specific chat
    socket.on('join-chat', async (data) => {
        const { chatId, chatType, username } = data;
        
        // Leave previous rooms
        Array.from(socket.rooms)
            .filter(room => room !== socket.id)
            .forEach(room => socket.leave(room));
        
        // Join new room
        const roomId = `${chatType}_${chatId}`;
        socket.join(roomId);
        
        // Load chat history - pass the socket and username
        const messages = await getChatHistory(chatId, chatType, socket, username);
        socket.emit('chat-history', messages);
    });
    
    // Handle messages
    socket.on('message', async (data) => {
        const { message, sender, chatId, chatType, dateTime } = data;
        
        try {
            // First, send message to recipient immediately (before DB operation)
            if (chatType === 'direct') {
                // Find recipient's socket
                const recipientSocketId = findSocketIdByUsername(chatId);
                
                // Emit message to recipient
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('chat-message', {
                        message,
                        sender,
                        recipient: chatId,
                        chatId,
                        chatType,
                        dateTime
                    });
                }
                
                // Also send to sender to ensure they see their own message
                socket.emit('chat-message', {
                    message,
                    sender,
                    recipient: chatId,
                    chatId,
                    chatType,
                    dateTime
                });
            } else {
                // Broadcast to the group room
                io.to(`${chatType}_${chatId}`).emit('chat-message', {
                    message,
                    sender,
                    chatId,
                    chatType,
                    dateTime
                });
            }

            // Then try to save to database (this won't block the message delivery)
            try {
                // Use a simpler query with columns we know exist
                await pool.query(
                    'INSERT INTO messages (sender, message) VALUES ($1, $2)',
                    [sender, message]
                );
            } catch (dbError) {
                console.error('Error saving message to database:', dbError);
                // Don't rethrow - we still delivered the message in real-time
            }
        } catch (error) {
            console.error('Error handling message:', error);
            // Still send confirmation to sender to avoid UI hanging
            socket.emit('message-error', { error: 'Failed to deliver message' });
        }
    });
    
    // Handle typing indicator
    socket.on('typing', (data) => {
        const { name, chatId, chatType } = data;
        
        if (chatType === 'direct') {
            // Find recipient's socket
            const recipientSocketId = findSocketIdByUsername(chatId);
            
            // Emit typing event to recipient only
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('typing-response', {
                    name,
                    chatId,
                    chatType
                });
            }
        } else {
            // Broadcast to group (except sender)
            socket.to(`${chatType}_${chatId}`).emit('typing-response', {
                name,
                chatId,
                chatType
            });
        }
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        if (onlineUsers.has(socket.id)) {
            onlineUsers.delete(socket.id);
            broadcastOnlineUsers();
        }
    });
});

// Helper function to get chat history
async function getChatHistory(chatId, chatType, socket, username) {
    try {
        let query;
        let params;
        
        if (chatType === 'direct') {
            // For direct messages, get messages where either sender/recipient match the users
            query = `
                SELECT * FROM messages 
                WHERE ((sender = $1) OR (sender = $2))
                ORDER BY created_at ASC
                LIMIT 50
            `;
            
            // Use the username from parameter
            params = [chatId, username];
        } else {
            // For group chats, get messages for the specified group ID
            query = `
                SELECT * FROM messages 
                WHERE sender IN (
                    SELECT username FROM group_members WHERE group_id = $1
                )
                ORDER BY created_at ASC
                LIMIT 50
            `;
            params = [chatId];
        }
        
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error fetching chat history:', error);
        return [];
    }
}

// Helper function to find socket ID by username
function findSocketIdByUsername(username) {
    for (const [socketId, user] of onlineUsers.entries()) {
        if (user === username) {
            return socketId;
        }
    }
    return null;
}

// Broadcast online users to all connected clients
function broadcastOnlineUsers() {
    const users = Array.from(onlineUsers.values());
    io.emit('users-online', users);
}

// Start the server
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});