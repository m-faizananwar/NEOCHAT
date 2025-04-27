// Global variables
const socket = io();
const messageContainer = document.querySelector('#messages-container');
const messageInput = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-btn');
const typingIndicator = document.createElement('div');
const logoutButton = document.getElementById('logout-button');
const usernameDisplay = document.getElementById('username-display');
const tabDirect = document.getElementById('tab-direct');
const tabGroups = document.getElementById('tab-groups');
const createGroupBtn = document.getElementById('create-group-btn');
const createGroupContainer = document.getElementById('create-group-container');
const groupModal = document.getElementById('group-modal');
const cancelGroupBtn = document.getElementById('cancel-group');
const createGroupSubmitBtn = document.getElementById('create-group');

// Current chat info
let currentChatId = null;
let currentChatType = null; // 'direct' or 'group'
let currentUsername = '';
let onlineUsers = [];
let groupChats = [];

// Add typing indicator to DOM
typingIndicator.className = 'text-sm text-gray-500 italic hidden';
typingIndicator.textContent = 'Someone is typing...';
messageContainer.parentNode.insertBefore(typingIndicator, messageContainer.nextSibling);

// Check if user is authenticated
async function checkAuth() {
    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        if (response.ok) {
            currentUsername = data.username;
            usernameDisplay.textContent = currentUsername;
            return true;
        } else {
            window.location.href = '/login.html';
            return false;
        }
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/login.html';
        return false;
    }
}

// Initialize app
async function initApp() {
    if (await checkAuth()) {
        socket.emit('user-connected', { username: currentUsername });
        loadDirectChats();
        setupEventListeners();
    }
}

// Tab switching functionality
function setupTabs() {
    tabDirect.addEventListener('click', () => {
        tabDirect.classList.add('bg-indigo-100', 'text-indigo-600');
        tabDirect.classList.remove('text-gray-600', 'hover:bg-gray-50');
        tabGroups.classList.remove('bg-indigo-100', 'text-indigo-600');
        tabGroups.classList.add('text-gray-600', 'hover:bg-gray-50');
        createGroupContainer.classList.add('hidden');
        loadDirectChats();
    });

    tabGroups.addEventListener('click', () => {
        tabGroups.classList.add('bg-indigo-100', 'text-indigo-600');
        tabGroups.classList.remove('text-gray-600', 'hover:bg-gray-50');
        tabDirect.classList.remove('bg-indigo-100', 'text-indigo-600');
        tabDirect.classList.add('text-gray-600', 'hover:bg-gray-50');
        createGroupContainer.classList.remove('hidden');
        loadGroupChats();
    });
}

// Load direct message contacts
async function loadDirectChats() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        
        const contactsContainer = document.getElementById('contacts-container');
        contactsContainer.innerHTML = '';
        
        users.forEach(user => {
            if (user.username !== currentUsername) {
                const contactElement = createContactElement(user, 'direct');
                contactsContainer.appendChild(contactElement);
            }
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Load group chats
async function loadGroupChats() {
    try {
        const response = await fetch('/api/groups');
        groupChats = await response.json();
        
        const contactsContainer = document.getElementById('contacts-container');
        contactsContainer.innerHTML = '';
        
        groupChats.forEach(group => {
            const contactElement = createContactElement(group, 'group');
            contactsContainer.appendChild(contactElement);
        });
    } catch (error) {
        console.error('Error loading groups:', error);
    }
}

// Create contact/group element
function createContactElement(entity, type) {
    const div = document.createElement('div');
    div.className = 'contact p-4 border-b hover:bg-gray-100 flex items-center cursor-pointer';
    
    const isOnline = type === 'direct' ? onlineUsers.includes(entity.username) : true;
    const statusClass = isOnline ? 'bg-green-400' : 'bg-gray-400';
    const lastMessage = entity.lastMessage || '';
    const timestamp = entity.lastMessageTime ? moment(entity.lastMessageTime).format('h:mm A') : '';
    
    div.innerHTML = `
        <div class="relative">
            <img src="https://dummyimage.com/40x40/000/fff" alt="${type === 'direct' ? 'User' : 'Group'}" class="h-12 w-12 rounded-full">
            <div class="absolute bottom-0 right-0 h-3 w-3 ${statusClass} rounded-full border-2 border-white"></div>
        </div>
        <div class="ml-3 flex-1">
            <h3 class="text-md font-semibold">${type === 'direct' ? entity.username : entity.name}</h3>
            <p class="text-sm text-gray-600 truncate">${lastMessage}</p>
        </div>
        ${timestamp ? `<div class="text-xs text-gray-500">${timestamp}</div>` : ''}
    `;
    
    div.addEventListener('click', () => {
        selectChat(entity.id || entity.username, type, entity.name || entity.username);
    });
    
    return div;
}

// Select a chat
function selectChat(chatId, chatType, chatName) {
    currentChatId = chatId;
    currentChatType = chatType;
    
    // Update chat header
    document.getElementById('chat-name').textContent = chatName;
    document.getElementById('chat-status').textContent = chatType === 'direct' ? 'Online' : `${chatType === 'group' ? 'Group chat' : ''}`;
    
    // Enable input controls
    messageInput.disabled = false;
    sendButton.disabled = false;
    
    // Show action buttons
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('video-btn').classList.remove('hidden');
    document.getElementById('info-btn').classList.remove('hidden');
    
    // Load chat history
    socket.emit('join-chat', { 
        chatId: chatId, 
        chatType: chatType,
        username: currentUsername
    });
    
    // Highlight selected chat
    const contacts = document.querySelectorAll('.contact');
    contacts.forEach(contact => {
        contact.classList.remove('bg-indigo-50');
    });
    event.currentTarget.classList.add('bg-indigo-50');
}

// Add message to UI
function addMessageToUI(message, sender, isOwnMessage, dateTime) {
    const messageElement = document.createElement('div');
    messageElement.className = isOwnMessage 
        ? 'flex items-start justify-end' 
        : 'flex items-start';
    
    const formattedTime = moment(dateTime).format('h:mm A');
    
    if (isOwnMessage) {
        messageElement.innerHTML = `
            <div class="flex flex-col items-end">
                <div class="bg-indigo-600 text-white p-3 rounded-lg shadow-sm max-w-xs md:max-w-md">
                    <p class="text-sm">${escapeHTML(message)}</p>
                </div>
                <span class="text-xs text-gray-500 leading-none mt-1">${formattedTime}</span>
            </div>
        `;
    } else {
        messageElement.innerHTML = `
            <img src="https://via.placeholder.com/40" alt="Contact" class="h-10 w-10 rounded-full mr-3">
            <div>
                <div class="font-medium text-sm mb-1">${escapeHTML(sender)}</div>
                <div class="bg-white p-3 rounded-lg shadow-sm max-w-xs md:max-w-md">
                    <p class="text-sm">${escapeHTML(message)}</p>
                </div>
                <span class="text-xs text-gray-500 leading-none mt-1 block">${formattedTime}</span>
            </div>
        `;
    }
    
    messageContainer.appendChild(messageElement);
    scrollToBottom();
}

// Set up all event listeners
function setupEventListeners() {
    // Logout functionality
    logoutButton.addEventListener('click', async () => {
        try {
            await fetch('/logout');
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    });

    // Send message
    sendButton.addEventListener('click', sendMessage);
    
    // Send on Enter
    messageInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
        
        // Emit typing event
        socket.emit('typing', { 
            name: currentUsername,
            chatId: currentChatId,
            chatType: currentChatType
        });
    });
    
    // Group chat modal controls
    createGroupBtn.addEventListener('click', openGroupModal);
    cancelGroupBtn.addEventListener('click', closeGroupModal);
    createGroupSubmitBtn.addEventListener('click', createNewGroup);
    
    // Mobile menu toggle
    document.getElementById('mobile-menu-button').addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('hidden');
    });
    
    // Setup tabs
    setupTabs();
}

// Send message function
function sendMessage() {
    if (!messageInput.value.trim() || !currentChatId) return;
    
    const data = {
        message: messageInput.value.trim(),
        sender: currentUsername,
        chatId: currentChatId,
        chatType: currentChatType,
        dateTime: new Date()
    };
    
    // Emit message event to server
    socket.emit('message', data);
    
    // Clear input
    messageInput.value = '';
}

// Group chat modal functions
function openGroupModal() {
    groupModal.classList.remove('hidden');
    loadUsersForGroupCreation();
}

function closeGroupModal() {
    groupModal.classList.add('hidden');
}

async function loadUsersForGroupCreation() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        
        const membersContainer = document.getElementById('group-members');
        membersContainer.innerHTML = '';
        
        users.forEach(user => {
            if (user.username !== currentUsername) {
                const userElement = document.createElement('div');
                userElement.className = 'flex items-center mb-2';
                userElement.innerHTML = `
                    <input type="checkbox" id="user-${user.id}" value="${user.id}" class="mr-2">
                    <label for="user-${user.id}">${user.username}</label>
                `;
                membersContainer.appendChild(userElement);
            }
        });
    } catch (error) {
        console.error('Error loading users for group creation:', error);
    }
}

async function createNewGroup() {
    const groupName = document.getElementById('group-name').value.trim();
    if (!groupName) return;
    
    const memberCheckboxes = document.querySelectorAll('#group-members input[type="checkbox"]:checked');
    const memberIds = Array.from(memberCheckboxes).map(cb => cb.value);
    
    if (memberIds.length === 0) return;
    
    try {
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: groupName,
                members: memberIds,
                creator: currentUsername
            })
        });
        
        if (response.ok) {
            closeGroupModal();
            loadGroupChats();
        }
    } catch (error) {
        console.error('Error creating group:', error);
    }
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    initApp();
});

socket.on('users-online', (users) => {
    onlineUsers = users;
    if (tabDirect.classList.contains('bg-indigo-100')) {
        loadDirectChats();
    }
});

socket.on('chat-history', (messages) => {
    // Clear existing messages
    messageContainer.innerHTML = '';
    
    // Add each message from history
    messages.forEach(msg => {
        addMessageToUI(
            msg.message, 
            msg.sender, 
            msg.sender === currentUsername, 
            new Date(msg.created_at)
        );
    });
    
    // Scroll to bottom
    scrollToBottom();
});

socket.on('chat-message', (data) => {
    if ((data.chatType === currentChatType && data.chatId === currentChatId) ||
        (data.chatType === 'direct' && data.sender === currentChatId) ||
        (data.chatType === 'direct' && data.recipient === currentChatId)) {
        
        addMessageToUI(
            data.message, 
            data.sender, 
            data.sender === currentUsername, 
            new Date(data.dateTime)
        );
        
        // Hide typing indicator when message is received
        typingIndicator.classList.add('hidden');
    }
    
    // Update last message in chat list
    if (currentChatType === data.chatType) {
        loadDirectChats();
    } else {
        loadGroupChats();
    }
});

socket.on('typing-response', (data) => {
    if ((data.chatType === currentChatType && data.chatId === currentChatId) ||
        (data.chatType === 'direct' && data.name === currentChatId)) {
        
        typingIndicator.textContent = `${data.name} is typing...`;
        typingIndicator.classList.remove('hidden');
        
        // Hide the typing indicator after 3 seconds
        setTimeout(() => {
            typingIndicator.classList.add('hidden');
        }, 3000);
    }
});

// Utility functions
function scrollToBottom() {
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}