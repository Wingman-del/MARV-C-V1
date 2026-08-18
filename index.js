const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const config = require('./config');
const { handleCommand, getMenuText } = require('./commands');
const express = require('express');

// Force clean session on startup
if (fs.existsSync('auth_info')) {
    console.log('🗑️ Clearing old session...');
    fs.rmSync('auth_info', { recursive: true, force: true });
    console.log('✅ Session cleared!');
}

let sock;
let startTime = Date.now();
let isTypingTimeout = null;
let pairingCode = '';
let isConnecting = false;
let welcomeSent = false;
let isConnected = false;
let reconnectAttempts = 0;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// Function to send typing indicator
const sendTyping = async (jid) => {
    try {
        if (!sock || !isConnected) return;
        await sock.sendPresenceUpdate('composing', jid);
        if (isTypingTimeout) clearTimeout(isTypingTimeout);
        isTypingTimeout = setTimeout(() => {
            sock.sendPresenceUpdate('paused', jid);
        }, config.TYPING_DELAY || 15000);
    } catch (error) {
        console.log('Typing error:', error);
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

// Send welcome message
async function sendWelcomeMessage() {
    if (welcomeSent || !sock || !isConnected) return;
    
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
        
    } catch (error) {
        console.log('⚠️ Could not send welcome message:', error.message);
    }
}

// Generate pairing code
async function generatePairingCode(phoneNumber) {
    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        if (!sock) {
            console.log('⏳ Socket not ready, waiting...');
            return null;
        }
        
        console.log(`🔑 Generating pairing code for ${cleanNumber}...`);
        const code = await sock.requestPairingCode(cleanNumber);
        pairingCode = code;
        
        console.log('\n========================================');
        console.log(`🔑 YOUR PAIRING CODE: ${code}`);
        console.log(`📱 Phone: ${cleanNumber}`);
        console.log('========================================');
        console.log(`📱 Go to WhatsApp → Settings → Linked Devices → Link a Device`);
        console.log(`📱 Enter this code: ${code}`);
        console.log('========================================\n');
        
        return code;
    } catch (error) {
        console.log('⚠️ Failed to generate pairing code:', error.message);
        pairingCode = '';
        return null;
    }
}

// Main connection function
async function connectToWhatsApp() {
    if (isConnecting) {
        console.log('⏳ Already connecting...');
        return;
    }
    isConnecting = true;
    isConnected = false;
    
    try {
        console.log('🔌 Initializing WhatsApp connection...');
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
            markOnlineOnConnect: true,
            shouldSyncHistoryMessage: () => false,
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            console.log(`📡 Connection update: ${connection}`);
            
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = code !== DisconnectReason.loggedOut;
                console.log(`❌ Connection closed. Code: ${code}, Should reconnect: ${shouldReconnect}`);
                isConnecting = false;
                isConnected = false;
                welcomeSent = false;
                
                if (shouldReconnect && reconnectAttempts < 10) {
                    reconnectAttempts++;
                    const delay = 5000 * Math.min(reconnectAttempts, 5);
                    console.log(`🔄 Reconnect attempt ${reconnectAttempts}/10 in ${delay/1000}s`);
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, delay);
                }
            } else if (connection === 'open') {
                console.log('✅ MARV-C V1 Bot is Online!');
                isConnected = true;
                isConnecting = false;
                reconnectAttempts = 0;
                pairingCode = '';
                startTime = Date.now();
                
                console.log(`📱 Bot connected as: ${sock.user?.name || 'Unknown'}`);
                console.log(`📱 Phone number: ${sock.user?.id?.split(':')[0] || 'Unknown'}`);
                
                // Send welcome message after connection
                setTimeout(async () => {
                    if (!welcomeSent && isConnected) {
                        await sendWelcomeMessage();
                    }
                }, 3000);
            } else if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
            }
        });

        // Save credentials
        sock.ev.on('creds.update', (creds) => {
            console.log('💾 Credentials updated and saved');
            saveCreds();
        });

        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (!isConnected || !sock) {
                    console.log('⚠️ Bot not connected, skipping message');
                    return;
                }
                
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
                
                console.log(`📨 Message from ${remoteJid}: "${messageText}"`);
                
                const isGroup = remoteJid.endsWith('@g.us');
                const sender = msg.key.participant || msg.key.remoteJid;
                const isOwner = sender === `${config.OWNER_NUMBER}@s.whatsapp.net`;
                
                if (!isGroup && !isOwner) {
                    console.log(`⏭️ Not owner (${sender}), skipping`);
                    return;
                }
                
                if (messageText.startsWith(config.PREFIX)) {
                    console.log(`✅ Command detected: ${messageText}`);
                    const command = messageText.slice(1).trim();
                    
                    await sendTyping(remoteJid);
                    await handleCommand(sock, remoteJid, command, msg, config, startTime);
                    console.log('✅ Command processed');
                }
            } catch (error) {
                console.error('❌ Error in message handler:', error);
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

// API endpoints
app.post('/generate-code', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.json({ success: false, error: 'Phone number required' });
    }
    
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
        return res.json({ success: false, error: 'Invalid phone number format' });
    }
    
    if (!isConnected) {
        if (!sock) {
            await connectToWhatsApp();
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        const code = await generatePairingCode(cleanNumber);
        
        if (code) {
            res.json({ success: true, code: code, phoneNumber: cleanNumber });
        } else {
            res.json({ success: false, error: 'Failed to generate code' });
        }
    } else {
        res.json({ success: false, error: 'Bot already connected!' });
    }
});

app.get('/status', (req, res) => {
    res.json({
        connected: isConnected && sock && sock.user,
        botName: config.BOT_NAME,
        phoneNumber: (isConnected && sock?.user) ? sock.user.id?.split(':')[0] : 'Not connected',
        uptime: isConnected ? getUptime() : 'Offline',
        pairingCode: pairingCode || 'None',
        welcomeSent: welcomeSent,
        reconnectAttempts: reconnectAttempts
    });
});

// Web interface
app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>MARV-C V1</title>
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
                .bot-name { text-align: center; font-size: 28px; font-weight: bold; color: #333; }
                .subtitle { text-align: center; color: #666; margin: 10px 0 30px; }
                .status-box {
                    padding: 20px;
                    border-radius: 10px;
                    text-align: center;
                    margin-bottom: 20px;
                }
                .status-box.online { background: #d4edda; color: #155724; }
                .status-box.waiting { background: #d1ecf1; color: #0c5460; }
                .status-dot {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    margin-right: 10px;
                }
                .status-dot.online { background: #4CAF50; }
                .status-dot.waiting { background: #FF9800; }
                .code-display {
                    background: #f8f9fa;
                    border-radius: 12px;
                    padding: 20px;
                    text-align: center;
                    margin: 20px 0;
                }
                .code-number {
                    font-size: 36px;
                    font-weight: bold;
                    letter-spacing: 6px;
                    color: #333;
                    font-family: 'Courier New', monospace;
                }
                input[type="text"] {
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #ddd;
                    border-radius: 10px;
                    font-size: 16px;
                    margin-bottom: 10px;
                }
                .btn {
                    width: 100%;
                    padding: 12px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                }
                .btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .info { margin-top: 15px; font-size: 13px; color: #888; text-align: center; }
                @media (max-width: 600px) {
                    .container { padding: 20px; }
                    .code-number { font-size: 28px; letter-spacing: 4px; }
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
                    <div style="font-size:14px;color:#666;margin-bottom:5px;">🔑 Pairing Code</div>
                    <div class="code-number" id="codeNumber">------</div>
                </div>
                
                <input type="text" id="phoneInput" placeholder="Enter number (e.g., 254759083715)">
                <button class="btn" id="generateBtn">Get Pairing Code</button>
                
                <div class="info" id="info">Enter your number and click the button</div>
            </div>
            
            <script>
                async function updateStatus() {
                    try {
                        const response = await fetch('/status');
                        const data = await response.json();
                        
                        const statusBox = document.getElementById('statusBox');
                        const statusDot = document.getElementById('statusDot');
                        const statusText = document.getElementById('statusText');
                        const codeNumber = document.getElementById('codeNumber');
                        const info = document.getElementById('info');
                        
                        if (data.connected) {
                            statusBox.className = 'status-box online';
                            statusDot.className = 'status-dot online';
                            statusText.textContent = '✅ Connected as ' + data.phoneNumber;
                            document.getElementById('codeDisplay').style.display = 'none';
                            info.textContent = '✅ Bot is online! Send .help in WhatsApp';
                        } else {
                            statusBox.className = 'status-box waiting';
                            statusDot.className = 'status-dot waiting';
                            statusText.textContent = '🔄 Waiting for connection...';
                            
                            if (data.pairingCode && data.pairingCode !== 'None') {
                                codeNumber.textContent = data.pairingCode;
                                document.getElementById('codeDisplay').style.display = 'block';
                                info.textContent = '⏰ Enter this code in WhatsApp → Settings → Linked Devices';
                            } else {
                                document.getElementById('codeDisplay').style.display = 'block';
                                codeNumber.textContent = '------';
                                info.textContent = 'Enter your number and click the button';
                            }
                        }
                    } catch (error) {
                        console.log('Status check failed');
                    }
                }
                
                setInterval(updateStatus, 3000);
                updateStatus();
                
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
                            updateStatus();
                        } else {
                            alert('❌ ' + (data.error || 'Failed to generate code'));
                        }
                    } catch (error) {
                        alert('❌ Network error. Please try again.');
                    } finally {
                        btn.disabled = false;
                        btn.textContent = 'Get Pairing Code';
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
console.log('📱 Generate a pairing code via the web interface');

// Try to connect
connectToWhatsApp();

// Keep trying if connection fails
setInterval(() => {
    if (!isConnected && !isConnecting) {
        console.log('🔄 Attempting to reconnect...');
        connectToWhatsApp();
    }
}, 30000);
