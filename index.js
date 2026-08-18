const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore
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

// Create express app for pairing code display
const app = express();
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

// Main connection function with pairing code
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        // Enable pairing code
        getMessage: async () => {
            // Optional: implement if needed
        }
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Generate pairing code if not connected
        if (!sock.authState.creds.registered && !pairingCode) {
            try {
                // Request pairing code
                const phoneNumber = config.OWNER_NUMBER.replace('+', '');
                const code = await sock.requestPairingCode(phoneNumber);
                pairingCode = code;
                console.log('\n========================================');
                console.log(`🔑 YOUR PAIRING CODE: ${code}`);
                console.log('========================================');
                console.log(`📱 Go to WhatsApp → Settings → Linked Devices → Link a Device`);
                console.log(`📱 Enter this code: ${code}`);
                console.log('========================================\n');
            } catch (error) {
                console.log('Failed to generate pairing code:', error);
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                pairingCode = ''; // Reset pairing code
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ MARV-C V1 Bot is Online!');
            await updatePresence('available');
            startTime = Date.now();
            console.log(`📱 Bot connected as: ${sock.user?.name || 'Unknown'}`);
            console.log(`📱 Phone number: ${sock.user?.id?.split(':')[0] || 'Unknown'}`);
            pairingCode = ''; // Clear pairing code after connection
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
}

// Web server for displaying pairing code
app.get('/', (req, res) => {
    if (pairingCode) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>MARV-C V1 - Pairing Code</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        margin: 0;
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    .container {
                        background: rgba(255,255,255,0.1);
                        backdrop-filter: blur(10px);
                        padding: 40px;
                        border-radius: 20px;
                        max-width: 500px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    }
                    .code {
                        font-size: 48px;
                        font-weight: bold;
                        background: white;
                        color: #333;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                        letter-spacing: 5px;
                    }
                    .steps {
                        text-align: left;
                        background: rgba(0,0,0,0.2);
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                    }
                    .status {
                        display: inline-block;
                        padding: 10px 20px;
                        background: #4CAF50;
                        border-radius: 5px;
                        margin-top: 10px;
                    }
                    .bot-name {
                        font-size: 24px;
                        margin-bottom: 10px;
                    }
                    @media (max-width: 600px) {
                        .code { font-size: 32px; padding: 15px; }
                        .container { padding: 20px; margin: 10px; }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="bot-name">🤖 MARV-C V1</div>
                    <h1>🔑 Pairing Code</h1>
                    <div class="code">${pairingCode}</div>
                    <div class="steps">
                        <h3>📝 Steps to Connect:</h3>
                        <ol>
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings → Linked Devices</li>
                            <li>Tap "Link a Device"</li>
                            <li>Enter the code above</li>
                        </ol>
                    </div>
                    <div class="status">✅ Waiting for connection...</div>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>MARV-C V1</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        margin: 0;
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    .container {
                        background: rgba(255,255,255,0.1);
                        backdrop-filter: blur(10px);
                        padding: 40px;
                        border-radius: 20px;
                        max-width: 500px;
                    }
                    .status {
                        padding: 20px;
                        background: ${pairingCode ? '#4CAF50' : '#FF9800'};
                        border-radius: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 MARV-C V1</h1>
                    <div class="status">
                        ${pairingCode ? '✅ Connected!' : '🔄 Generating pairing code...'}
                    </div>
                    <p>${pairingCode ? 'Bot is online and ready!' : 'Please wait a moment...'}</p>
                </div>
            </body>
            </html>
        `);
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`📱 Visit your Render URL to get pairing code`);
});

// Start the bot
console.log('🚀 Starting MARV-C V1 Bot...');
console.log('📱 A pairing code will be generated...');
connectToWhatsApp().catch(err => {
    console.error('❌ Failed to start bot:', err);
});
