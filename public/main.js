const socket = io();
const messageContainer = document.querySelector('.flex-1.px-6.py-4.overflow-y-auto .space-y-6');
const messageInput = document.querySelector('input[type="text"][placeholder="Type a message..."]');
const sendButton = document.querySelector('.ml-3.bg-indigo-600.text-white.rounded-full');
const typingIndicator = document.createElement('div');

typingIndicator.className = 'text-sm text-gray-500 italic hidden';
typingIndicator.textContent = 'Someone is typing...';
messageContainer.parentNode.insertBefore(typingIndicator, messageContainer.nextSibling);

// Get username from prompt or use "Anonymous"
let username = localStorage.getItem('chat-username');
if (!username) {
    username = prompt('Enter your name to join the chat:') || 'Anonymous';
    localStorage.setItem('chat-username', username);
}

// Handle total connected clients
socket.on('clients-total', (total) => {
    console.log('Total connected clients:', total);
    // You could update UI here to show total users
});

// Handle chat history
socket.on('chat-history', (messages) => {
    // Clear existing messages
    messageContainer.innerHTML = '';
    
    // Add each message from history
    messages.forEach(msg => {
        addMessageToUI(msg.message, msg.sender, socket.id !== 'server', new Date(msg.created_at));
    });
    
    // Scroll to bottom
    scrollToBottom();
});

// Handle receiving messages
socket.on('chat-message', (data) => {
    console.log('Message received from server:', data);
    const isOwnMessage = data.id === socket.id;
    addMessageToUI(data.message, data.name, isOwnMessage, new Date(data.dateTime));
    scrollToBottom();
    
    // Hide typing indicator when message is received
    typingIndicator.classList.add('hidden');
});

// Handle typing indicator
socket.on('typing-response', (data) => {
    typingIndicator.textContent = `${data.name} is typing...`;
    typingIndicator.classList.remove('hidden');
    
    // Hide the typing indicator after 3 seconds
    setTimeout(() => {
        typingIndicator.classList.add('hidden');
    }, 3000);
});

// Send message when clicking the send button
sendButton.addEventListener('click', sendMessage);

// Send message when pressing Enter in the input field
messageInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
    
    // Emit typing event
    socket.emit('typing', { name: username });
});

function sendMessage() {
    if (messageInput.value.trim() === '') return;
    
    const data = {
        message: messageInput.value.trim(),
        name: username,
        dateTime: new Date()
    };
    
    // Emit message event to server
    socket.emit('message', data);
    
    // Clear input
    messageInput.value = '';
}

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
}

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