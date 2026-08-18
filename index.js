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
const { handleCommand, getMenuText } = require('./commands');
const express = require('express');

let sock;
let startTime = Date.now();
let isTypingTimeout = null;
let pairingCode = '';
let isConnecting = false;
let phoneNumberInput = '';
let codeExpiry = null;
let welcomeSent = false;
let isConnected = false;
let reconnectAttempts = 0;
let pairingTimer = null;

// Create express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// Function to show typing indicator
const sendTyping = async (jid) => {
    try {
        if (!sock) return;
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
        if (!sock) return;
        await sock.sendPresenceUpdate(status);
    } catch (error) {
        console.log('Presence update error:', error);
    }
};

// Function to get uptime
function getUptime() {
    const now = Date.now();
    const diff = now - startTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}hrs${String(minutes).padStart(2, '0')}min${String(seconds).padStart(2, '0')}sec`;
}

// Function to send welcome message with menu to owner
async function sendWelcomeMessage() {
    if (welcomeSent || !sock) return;
    
    const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
    
    try {
        const menuText = getMenuText(config.PREFIX);
        
        const welcomeMessage = `*🤖 MARV-C V1 IS NOW ONLINE!*\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `✅ Successfully connected to your WhatsApp account\n\n` +
                              `📱 *Bot Info:*\n` +
                              `• Name: ${config.BOT_NAME}\n` +
                              `• Owner: ${config.OWNER_NAME}\n` +
                              `• Status: Online 🟢\n` +
                              `• Uptime: ${getUptime()}\n` +
                              `• Connected: ${new Date().toLocaleString()}\n\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `${menuText}\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `_Type any command with the prefix *${config.PREFIX}*_\n` +
                              `_Example: *${config.PREFIX}help*_\n\n` +
                              `✨ *Enjoy automating with MARV-C V1!* ✨`;
        
        await sock.sendMessage(ownerJid, {
            text: welcomeMessage
        });
        
        console.log('📨 Welcome message sent to owner!');
        welcomeSent = true;
        
        setTimeout(async () => {
            try {
                await sock.sendMessage(ownerJid, {
                    text: `⚡ *Quick Commands:*\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━\n` +
                          `${config.PREFIX}help - Show full menu\n` +
                          `${config.PREFIX}uptime - Bot uptime\n` +
                          `${config.PREFIX}owner - Owner info\n` +
                          `${config.PREFIX}botinfo - Bot details\n\n` +
                          `💡 _Use ${config.PREFIX}help for all commands_`
                });
            } catch (error) {
                console.log('Could not send quick commands:', error);
            }
        }, 2000);
        
    } catch (error) {
        console.log('⚠️ Could not send welcome message:', error.message);
    }
}

// Generate pairing code with proper connection
async function generatePairingCode(phoneNumber) {
    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        if (!sock) {
            console.log('⏳ Socket not ready, waiting...');
            return null;
        }
        
        // Clear any existing timer
        if (pairingTimer) {
            clearTimeout(pairingTimer);
            pairingTimer = null;
        }
        
        console.log(`🔑 Generating pairing code for ${cleanNumber}...`);
        const code = await sock.requestPairingCode(cleanNumber);
        pairingCode = code;
        codeExpiry = Date.now() + 60000;
        
        console.log('\n========================================');
        console.log(`🔑 YOUR PAIRING CODE: ${code}`);
        console.log(`📱 Phone: ${cleanNumber}`);
        console.log(`⏰ Expires in: 1 minute`);
        console.log('========================================');
        console.log(`📱 Go to WhatsApp → Settings → Linked Devices → Link a Device`);
        console.log(`📱 Enter this code: ${code}`);
        console.log('========================================\n');
        
        return code;
    } catch (error) {
        console.log('⚠️ Failed to generate pairing code:', error.message);
        pairingCode = '';
        codeExpiry = null;
        return null;
    }
}

// Main connection function
async function connectToWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;
    isConnected = false;
    
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
            // Prevent multiple connections
            patchMessageBeforeSending: true,
            markOnlineOnConnect: true,
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed, reconnecting:', shouldReconnect);
                isConnecting = false;
                isConnected = false;
                welcomeSent = false;
                
                if (shouldReconnect && reconnectAttempts < 5) {
                    reconnectAttempts++;
                    console.log(`Reconnect attempt ${reconnectAttempts}/5`);
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, 5000 * reconnectAttempts);
                } else if (reconnectAttempts >= 5) {
                    console.log('⚠️ Max reconnect attempts reached. Please restart the bot.');
                }
            } else if (connection === 'open') {
                console.log('✅ MARV-C V1 Bot is Online!');
                isConnected = true;
                isConnecting = false;
                reconnectAttempts = 0;
                
                // Clear pairing code on successful connection
                pairingCode = '';
                codeExpiry = null;
                if (pairingTimer) {
                    clearTimeout(pairingTimer);
                    pairingTimer = null;
                }
                
                await updatePresence('available');
                startTime = Date.now();
                console.log(`📱 Bot connected as: ${sock.user?.name || 'Unknown'}`);
                console.log(`📱 Phone number: ${sock.user?.id?.split(':')[0] || 'Unknown'}`);
                
                // Send welcome message after a delay to ensure connection is stable
                setTimeout(async () => {
                    if (!welcomeSent && isConnected) {
                        await sendWelcomeMessage();
                    }
                }, 3000);
            }
        });

        // Save credentials
        sock.ev.on('creds.update', saveCreds);

        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            // Skip if not connected
            if (!isConnected || !sock) return;
            
            const msg = m.messages[0];
            if (!msg || !msg.key) return;
            
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid) return;
            
            // Ignore messages from the bot itself
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
            
            // For personal inbox, process only owner messages
            if (!isGroup && !isOwner) return;
            
            // Show typing indicator
            await sendTyping(remoteJid);
            
            // Check for commands
            if (messageText.startsWith(config.PREFIX)) {
                const command = messageText.slice(1).trim();
                await handleCommand(sock, remoteJid, command, msg, config, startTime);
            }
        });

        return sock;
    } catch (error) {
        console.error('❌ Connection error:', error);
        isConnecting = false;
        isConnected = false;
        setTimeout(connectToWhatsApp, 10000);
    }
}

// API endpoint to generate pairing code
app.post('/generate-code', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.json({ success: false, error: 'Phone number required' });
    }
    
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
        return res.json({ success: false, error: 'Invalid phone number format' });
    }
    
    phoneNumberInput = cleanNumber;
    pairingCode = '';
    codeExpiry = null;
    
    // Only generate if not connected
    if (!isConnected) {
        if (!sock) {
            await connectToWhatsApp();
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
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
    } else {
        res.json({ 
            success: false, 
            error: 'Bot is already connected! Check your WhatsApp.' 
        });
    }
});

// Status endpoint
app.get('/status', (req, res) => {
    const status = {
        connected: isConnected && sock && sock.user,
        botName: config.BOT_NAME,
        phoneNumber: (isConnected && sock?.user) ? sock.user.id?.split(':')[0] : 'Not connected',
        deviceName: (isConnected && sock?.user) ? sock.user.name : 'Not connected',
        uptime: isConnected ? getUptime() : 'Offline',
        startTime: new Date(startTime).toISOString(),
        pairingCode: pairingCode || 'None',
        welcomeSent: welcomeSent,
        reconnectAttempts: reconnectAttempts
    };
    res.json(status);
});

// Web interface (simplified)
app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>MARV-C V1 - Status</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }
                .container {
                    background: rgba(255,255,255,0.95);
                    padding: 40px;
                    border-radius: 20px;
                    max-width: 500px;
                    width: 100%;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .bot-name { text-align: center; font-size: 28px; font-weight: bold; color: #333; margin-bottom: 10px; }
                .subtitle { text-align: center; color: #666; margin-bottom: 30px; font-size: 14px; }
                .status-box {
                    padding: 20px;
                    border-radius: 10px;
                    text-align: center;
                    margin-bottom: 20px;
                }
                .status-box.online { background: #d4edda; color: #155724; }
                .status-box.offline { background: #f8d7da; color: #721c24; }
                .status-box.waiting { background: #d1ecf1; color: #0c5460; }
                .status-dot {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    margin-right: 10px;
                }
                .status-dot.online { background: #4CAF50; }
                .status-dot.offline { background: #f44336; }
                .status-dot.waiting { background: #FF9800; }
                .code-display {
                    background: #f8f9fa;
                    border-radius: 12px;
                    padding: 20px;
                    text-align: center;
                    margin: 20px 0;
                    display: none;
                }
                .code-display.show { display: block; }
                .code-number {
                    font-size: 48px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    color: #333;
                    font-family: 'Courier New', monospace;
                }
                .input-group { margin-bottom: 20px; }
                .input-with-button { display: flex; gap: 10px; }
                input[type="text"] {
                    flex: 1;
                    padding: 12px 16px;
                    border: 2px solid #ddd;
                    border-radius: 10px;
                    font-size: 16px;
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
                }
                .btn:disabled { opacity: 0.6; cursor: not-allowed; }
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
                
                <div id="statusBox" class="status-box waiting">
                    <span id="statusDot" class="status-dot waiting"></span>
                    <span id="statusText">Starting...</span>
                </div>
                
                <div id="codeDisplay" class="code-display">
                    <div class="code-number" id="codeNumber">------</div>
                </div>
                
                <div class="input-group">
                    <input type="text" id="phoneInput" placeholder="Enter number (e.g., 254759083715)">
                    <div class="input-with-button">
                        <input type="text" id="phoneInput" placeholder="e.g., 254759083715" style="margin-right:10px;">
                        <button class="btn" id="generateBtn">Get Code</button>
                    </div>
                </div>
                
                <div id="info" style="margin-top:15px;font-size:13px;color:#888;text-align:center;"></div>
            </div>
            
            <script>
                let statusCheckInterval;
                
                async function updateStatus() {
                    try {
                        const response = await fetch('/status');
                        const data = await response.json();
                        
                        const statusBox = document.getElementById('statusBox');
                        const statusDot = document.getElementById('statusDot');
                        const statusText = document.getElementById('statusText');
                        const codeDisplay = document.getElementById('codeDisplay');
                        const codeNumber = document.getElementById('codeNumber');
                        const info = document.getElementById('info');
                        
                        if (data.connected) {
                            statusBox.className = 'status-box online';
                            statusDot.className = 'status-dot online';
                            statusText.textContent = '✅ Connected as ' + data.phoneNumber;
                            codeDisplay.classList.remove('show');
                            info.textContent = '📨 Welcome message sent! Check your WhatsApp inbox.';
                        } else {
                            statusBox.className = 'status-box waiting';
                            statusDot.className = 'status-dot waiting';
                            statusText.textContent = '🔄 Waiting for connection...';
                            
                            if (data.pairingCode && data.pairingCode !== 'None') {
                                codeNumber.textContent = data.pairingCode;
                                codeDisplay.classList.add('show');
                                info.textContent = '⏰ Code expires in 1 minute';
                            } else {
                                codeDisplay.classList.remove('show');
                                info.textContent = 'Enter your number and click "Get Code"';
                            }
                        }
                    } catch (error) {
                        console.log('Status check failed');
                    }
                }
                
                // Update status every 3 seconds
                setInterval(updateStatus, 3000);
                updateStatus();
                
                // Generate code button
                document.getElementById('generateBtn').addEventListener('click', async () => {
                    const phoneInput = document.getElementById('phoneInput');
                    const phoneNumber = phoneInput.value.trim();
                    
                    if (!phoneNumber) {
                        alert('Please enter your WhatsApp number');
                        return;
                    }
                    
                    const btn = document.getElementById('generateBtn');
                    btn.disabled = true;
                    btn.textContent = 'Generating...';
                    
                    try {
                        const response = await fetch('/generate-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phoneNumber: phoneNumber })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            alert('✅ Code generated! Check the status above.');
                        } else {
                            alert('❌ ' + (data.error || 'Failed to generate code'));
                        }
                    } catch (error) {
                        alert('❌ Network error. Please try again.');
                    } finally {
                        btn.disabled = false;
                        btn.textContent = 'Get Code';
                    }
                });
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// Start the bot
console.log('🚀 Starting MARV-C V1 Bot...');
console.log('⏳ Initializing connection, please wait...');

setTimeout(() => {
    connectToWhatsApp().catch(err => {
        console.error('❌ Failed to start bot:', err);
        setTimeout(() => connectToWhatsApp(), 30000);
    });
}, 3000);
