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

// Middleware for JSON parsing and session management
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key_here',
    resave: false,
    saveUninitialized: false
}));

// Create messages and users tables if they don't exist
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                room VARCHAR(255) DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Database initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

initializeDatabase();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

let connectedSockets = new Set();

// Middleware to check authentication
function checkAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.redirect('/login.html');
}

// Protect the main page
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// User registration route
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, passwordHash]
        );
        res.status(201).send({ message: 'Registered successfully' });
    } catch (error) {
        res.status(400).send({ error: 'Registration failed' });
    }
});

// User login route
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const userResult = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
        if (userResult.rowCount === 0) {
            return res.status(401).send({ error: 'Invalid credentials' });
        }
        const user = userResult.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).send({ error: 'Invalid credentials' });
        }
        req.session.userId = user.id;
        res.send({ message: 'Login successful' });
    } catch (error) {
        res.status(400).send({ error: 'Login failed' });
    }
});

// User logout route
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected');
    connectedSockets.add(socket.id); // Add the socket ID to the set
    console.log('Socket ID:', socket.id); // Log the socket ID
    io.emit('clients-total', connectedSockets.size); // Emit the total number of connected clients
    
    // Load chat history when a user connects
    loadChatHistory().then(messages => {
        socket.emit('chat-history', messages);
    }).catch(error => {
        console.error('Error loading chat history:', error);
    });
    
    // Handle new message
    socket.on('message', async (data) => {
        console.log('Message received:', data);
        
        // Store message in database
        try {
            await pool.query(
                'INSERT INTO messages (sender, message) VALUES ($1, $2)',
                [data.name, data.message]
            );
            
            // Broadcast message to all clients
            io.emit('chat-message', {
                message: data.message,
                name: data.name,
                id: socket.id,
                dateTime: data.dateTime
            });
        } catch (error) {
            console.error('Error storing message:', error);
        }
    });
    
    socket.on('typing', (data) => {
        socket.broadcast.emit('typing-response', data);
    });
    
    socket.on('disconnect', () => {
        connectedSockets.delete(socket.id); // Remove the socket ID from the set
        console.log('User disconnected');
        io.emit('clients-total', connectedSockets.size); // Emit the total number of connected clients
    });
});

// Function to load chat history from database
async function loadChatHistory() {
    try {
        const result = await pool.query(
            'SELECT * FROM messages ORDER BY created_at ASC LIMIT 50'
        );
        return result.rows;
    } catch (error) {
        console.error('Error fetching chat history:', error);
        return [];
    }
}

// Start the server
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});