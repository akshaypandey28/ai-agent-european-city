// Unique session identifier for current browser tab
const sessionId = Math.random().toString(36).substring(7);

// DOM Elements
const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

// Event Listeners
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    // 1. Render User Message
    appendMessage(text, 'user-message');
    userInput.value = '';

    // 2. Disable Controls
    userInput.disabled = true;
    sendBtn.disabled = true;

    // 3. Render Typing Placeholder
    const typingId = "typing-" + Date.now();
    appendMessage("Thinking...", 'ai-message', typingId);

    try {
        // 4. Send Request to API
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, message: text })
        });

        const data = await response.json();

        // 5. Clear Typing Placeholder
        const typingElement = document.getElementById(typingId);
        if (typingElement) {
            typingElement.remove();
        }

        // 6. Render Formatted AI Response
        if (data.success) {
            // Parse raw Markdown to HTML
            const formattedHTML = marked.parse(data.reply);
            appendMessage(formattedHTML, 'ai-message', null, true);
        } else {
            appendMessage("Sorry, I encountered an error processing your request.", 'ai-message');
        }
    } catch (error) {
        console.error("Error:", error);
        const typingElement = document.getElementById(typingId);
        if (typingElement) {
            typingElement.remove();
        }
        appendMessage("Failed to connect to the server.", 'ai-message');
    } finally {
        // 7. Re-enable Controls
        userInput.disabled = false;
        sendBtn.disabled = false;
        userInput.focus();
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function appendMessage(content, className, id = null, isHtml = false) {
    const div = document.createElement('div');
    div.className = `message ${className}`;
    if (id) div.id = id;

    if (isHtml) {
        div.innerHTML = content;
    } else {
        div.textContent = content;
    }

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}