const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const moment = require('moment');
const config = require('./config');
const { handleCommand } = require('./commands');
const express = require('express');

let sock;
let startTime = Date.now();
let isTypingTimeout = null;
let pairingCode = '';
let isConnecting = false;
let phoneNumberInput = '';
let codeExpiry = null;
let codeGenerationAttempts = 0;

// Create express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// Function to show typing indicator
const sendTyping = async (jid) => {
    try {
        await sock.sendPresenceUpdate('composing', jid);
        if (isTypingTimeout) clearTimeout(isTypingTimeout);
        isTypingTimeout = setTimeout(() => {
            sock.sendPresenceUpdate('paused', jid);
        }, config.TYPING_DELAY);
    } catch (error) {
        console.log('Typing error:', error);
    }
};

// Function to update presence
const updatePresence = async (status) => {
    try {
        await sock.sendPresenceUpdate(status);
    } catch (error) {
        console.log('Presence update error:', error);
    }
};

// Generate pairing code with proper connection
async function generatePairingCode(phoneNumber) {
    try {
        // Remove any formatting from phone number
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        if (!sock) {
            console.log('⏳ Socket not ready, waiting...');
            return null;
        }
        
        console.log(`🔑 Generating pairing code for ${cleanNumber}...`);
        const code = await sock.requestPairingCode(cleanNumber);
        pairingCode = code;
        codeExpiry = Date.now() + 60000; // 1 minute expiry
        codeGenerationAttempts++;
        
        console.log('\n========================================');
        console.log(`🔑 YOUR PAIRING CODE: ${code}`);
        console.log(`📱 Phone: ${cleanNumber}`);
        console.log(`⏰ Expires in: 1 minute`);
        console.log('========================================');
        console.log(`📱 Go to WhatsApp → Settings → Linked Devices → Link a Device`);
        console.log(`📱 Enter this code: ${code}`);
        console.log('========================================\n');
        
        // Auto-refresh after 1 minute
        setTimeout(() => {
            if (pairingCode && !sock.user) {
                console.log('🔄 Refreshing pairing code...');
                pairingCode = '';
                codeExpiry = null;
                generatePairingCode(cleanNumber);
            }
        }, 60000);
        
        return code;
    } catch (error) {
        console.log('⚠️ Failed to generate pairing code:', error.message);
        pairingCode = '';
        codeExpiry = null;
        
        // Retry after 3 seconds
        setTimeout(() => {
            if (!sock.user && phoneNumber) {
                generatePairingCode(phoneNumber);
            }
        }, 3000);
        return null;
    }
}

// Main connection function
async function connectToWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            browser: Browsers.macOS('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed, reconnecting:', shouldReconnect);
                isConnecting = false;
                if (shouldReconnect) {
                    pairingCode = '';
                    codeExpiry = null;
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ MARV-C V1 Bot is Online!');
                await updatePresence('available');
                startTime = Date.now();
                console.log(`📱 Bot connected as: ${sock.user?.name || 'Unknown'}`);
                console.log(`📱 Phone number: ${sock.user?.id?.split(':')[0] || 'Unknown'}`);
                pairingCode = '';
                codeExpiry = null;
                isConnecting = false;
            }
        });

        // Save credentials
        sock.ev.on('creds.update', saveCreds);

        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg || !msg.key) return;
            
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid) return;
            
            if (msg.key.fromMe) return;
            if (remoteJid === 'status@broadcast') return;
            
            let messageText = '';
            if (msg.message?.conversation) {
                messageText = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                messageText = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage?.caption) {
                messageText = msg.message.imageMessage.caption;
            } else if (msg.message?.videoMessage?.caption) {
                messageText = msg.message.videoMessage.caption;
            }
            
            if (!messageText) return;
            
            const isGroup = remoteJid.endsWith('@g.us');
            const sender = msg.key.participant || msg.key.remoteJid;
            const isOwner = sender === `${config.OWNER_NUMBER}@s.whatsapp.net`;
            
            if (!isGroup && !isOwner) return;
            
            await sendTyping(remoteJid);
            
            if (messageText.startsWith(config.PREFIX)) {
                const command = messageText.slice(1).trim();
                await handleCommand(sock, remoteJid, command, msg, config, startTime);
            }
        });

        return sock;
    } catch (error) {
        console.error('❌ Connection error:', error);
        isConnecting = false;
        setTimeout(connectToWhatsApp, 10000);
    }
}

// API endpoint to generate pairing code
app.post('/generate-code', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.json({ success: false, error: 'Phone number required' });
    }
    
    // Validate phone number
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
        return res.json({ success: false, error: 'Invalid phone number format' });
    }
    
    phoneNumberInput = cleanNumber;
    pairingCode = '';
    codeExpiry = null;
    
    // Check if socket is ready
    if (!sock) {
        await connectToWhatsApp();
        // Wait for socket to be ready
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Generate new code
    const code = await generatePairingCode(cleanNumber);
    
    if (code) {
        res.json({ 
            success: true, 
            code: code,
            expiresIn: 60,
            phoneNumber: cleanNumber
        });
    } else {
        res.json({ 
            success: false, 
            error: 'Failed to generate code. Retrying...' 
        });
    }
});

// Web interface
app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>MARV-C V1 - Pairing Code</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }
                .container {
                    background: rgba(255,255,255,0.95);
                    backdrop-filter: blur(10px);
                    padding: 40px;
                    border-radius: 20px;
                    max-width: 500px;
                    width: 100%;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .bot-name {
                    text-align: center;
                    font-size: 28px;
                    font-weight: bold;
                    color: #333;
                    margin-bottom: 10px;
                }
                .subtitle {
                    text-align: center;
                    color: #666;
                    margin-bottom: 30px;
                    font-size: 14px;
                }
                .input-group {
                    margin-bottom: 20px;
                }
                label {
                    display: block;
                    margin-bottom: 8px;
                    color: #555;
                    font-weight: 600;
                    font-size: 14px;
                }
                .input-with-button {
                    display: flex;
                    gap: 10px;
                }
                input[type="text"] {
                    flex: 1;
                    padding: 12px 16px;
                    border: 2px solid #ddd;
                    border-radius: 10px;
                    font-size: 16px;
                    transition: border-color 0.3s;
                }
                input[type="text"]:focus {
                    outline: none;
                    border-color: #667eea;
                }
                .btn {
                    padding: 12px 24px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.2s, box-shadow 0.2s;
                    white-space: nowrap;
                }
                .btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
                }
                .btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }
                .code-display {
                    background: #f8f9fa;
                    border-radius: 12px;
                    padding: 20px;
                    text-align: center;
                    margin: 20px 0;
                    display: none;
                }
                .code-display.show {
                    display: block;
                    animation: fadeIn 0.5s ease;
                }
                .code-number {
                    font-size: 48px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    color: #333;
                    font-family: 'Courier New', monospace;
                }
                .code-label {
                    color: #666;
                    font-size: 14px;
                    margin-bottom: 5px;
                }
                .timer {
                    color: #666;
                    font-size: 14px;
                    margin-top: 10px;
                }
                .timer span {
                    font-weight: bold;
                    color: #667eea;
                }
                .status-message {
                    padding: 12px;
                    border-radius: 10px;
                    margin-top: 15px;
                    display: none;
                    font-size: 14px;
                }
                .status-message.show {
                    display: block;
                    animation: fadeIn 0.3s ease;
                }
                .status-message.success {
                    background: #d4edda;
                    color: #155724;
                    border: 1px solid #c3e6cb;
                }
                .status-message.error {
                    background: #f8d7da;
                    color: #721c24;
                    border: 1px solid #f5c6cb;
                }
                .status-message.info {
                    background: #d1ecf1;
                    color: #0c5460;
                    border: 1px solid #bee5eb;
                }
                .steps {
                    margin-top: 20px;
                    padding: 15px;
                    background: #f8f9fa;
                    border-radius: 10px;
                    display: none;
                }
                .steps.show {
                    display: block;
                    animation: fadeIn 0.5s ease;
                }
                .steps h4 {
                    color: #333;
                    margin-bottom: 10px;
                }
                .steps ol {
                    padding-left: 20px;
                    color: #555;
                }
                .steps ol li {
                    margin-bottom: 8px;
                    line-height: 1.5;
                }
                .loading-spinner {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    border: 3px solid rgba(102, 126, 234, 0.3);
                    border-top: 3px solid #667eea;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    vertical-align: middle;
                    margin-right: 10px;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @media (max-width: 600px) {
                    .container { padding: 20px; }
                    .code-number { font-size: 32px; letter-spacing: 4px; }
                    .input-with-button { flex-direction: column; }
                    .btn { width: 100%; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="bot-name">🤖 MARV-C V1</div>
                <div class="subtitle">WhatsApp Automation Bot</div>
                
                <div class="input-group">
                    <label for="phoneInput">📱 Enter WhatsApp Number</label>
                    <div class="input-with-button">
                        <input type="text" id="phoneInput" placeholder="e.g., 254759083715" value="${phoneNumberInput || ''}">
                        <button class="btn" id="generateBtn">Generate Code</button>
                    </div>
                    <small style="color: #999; display: block; margin-top: 5px; font-size: 12px;">
                        Include country code without + (e.g., 254 for Kenya)
                    </small>
                </div>
                
                <div id="codeDisplay" class="code-display">
                    <div class="code-label">🔑 Your Pairing Code</div>
                    <div class="code-number" id="codeNumber">------</div>
                    <div class="timer">⏰ Refreshes in <span id="timerCount">60</span> seconds</div>
                </div>
                
                <div id="statusMessage" class="status-message"></div>
                
                <div id="steps" class="steps">
                    <h4>📝 How to Connect:</h4>
                    <ol>
                        <li>Open WhatsApp on your phone</li>
                        <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                        <li>Tap <strong>"Link a Device"</strong></li>
                        <li>Enter the 8-digit code shown above</li>
                        <li>Wait for connection confirmation</li>
                    </ol>
                </div>
            </div>
            
            <script>
                let timerInterval = null;
                let countdown = 60;
                
                const phoneInput = document.getElementById('phoneInput');
                const generateBtn = document.getElementById('generateBtn');
                const codeDisplay = document.getElementById('codeDisplay');
                const codeNumber = document.getElementById('codeNumber');
                const timerCount = document.getElementById('timerCount');
                const statusMessage = document.getElementById('statusMessage');
                const steps = document.getElementById('steps');
                
                generateBtn.addEventListener('click', generateCode);
                phoneInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') generateCode();
                });
                
                async function generateCode() {
                    const phoneNumber = phoneInput.value.trim();
                    
                    if (!phoneNumber) {
                        showStatus('Please enter your WhatsApp number', 'error');
                        return;
                    }
                    
                    // Validate number
                    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
                        showStatus('Invalid phone number. Must be 10-15 digits with country code.', 'error');
                        return;
                    }
                    
                    // Disable button and show loading
                    generateBtn.disabled = true;
                    generateBtn.innerHTML = '<span class="loading-spinner"></span> Generating...';
                    hideStatus();
                    codeDisplay.classList.remove('show');
                    steps.classList.remove('show');
                    
                    try {
                        const response = await fetch('/generate-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phoneNumber: cleanNumber })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            // Show code
                            codeNumber.textContent = data.code;
                            codeDisplay.classList.add('show');
                            steps.classList.add('show');
                            showStatus('✅ Code generated successfully!', 'success');
                            
                            // Start timer
                            startTimer(60);
                            
                            // Store phone number
                            localStorage.setItem('lastPhoneNumber', cleanNumber);
                        } else {
                            showStatus('❌ ' + (data.error || 'Failed to generate code'), 'error');
                        }
                    } catch (error) {
                        showStatus('❌ Network error. Please try again.', 'error');
                    } finally {
                        generateBtn.disabled = false;
                        generateBtn.textContent = 'Generate Code';
                    }
                }
                
                function startTimer(seconds) {
                    countdown = seconds;
                    timerCount.textContent = countdown;
                    
                    if (timerInterval) clearInterval(timerInterval);
                    
                    timerInterval = setInterval(() => {
                        countdown--;
                        timerCount.textContent = countdown;
                        
                        if (countdown <= 0) {
                            clearInterval(timerInterval);
                            // Auto-refresh code
                            generateCode();
                        }
                    }, 1000);
                }
                
                function showStatus(message, type) {
                    statusMessage.textContent = message;
                    statusMessage.className = 'status-message show ' + type;
                }
                
                function hideStatus() {
                    statusMessage.className = 'status-message';
                }
                
                // Load last phone number if exists
                const lastNumber = localStorage.getItem('lastPhoneNumber');
                if (lastNumber) {
                    phoneInput.value = lastNumber;
                }
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`📱 Visit your Render URL to get pairing code`);
});

// Start the bot with a delay
console.log('🚀 Starting MARV-C V1 Bot...');
console.log('⏳ Initializing connection, please wait...');

setTimeout(() => {
    connectToWhatsApp().catch(err => {
        console.error('❌ Failed to start bot:', err);
        setTimeout(() => connectToWhatsApp(), 30000);
    });
}, 3000);
