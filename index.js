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
const qrcode = require('qrcode-terminal');

let sock;
let startTime = Date.now();
let isTypingTimeout = null;

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

// Main connection function
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        // Remove printQRInTerminal - it's deprecated
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
    });

    // Handle QR Code display
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Display QR code when available
        if (qr) {
            console.log('\n📱 SCAN THIS QR CODE WITH WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n🔄 Waiting for QR scan...');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ MARV-C V1 Bot is Online!');
            await updatePresence('available');
            startTime = Date.now();
            console.log(`📱 Bot connected as: ${sock.user?.name || 'Unknown'}`);
            console.log(`📱 Phone number: ${sock.user?.id?.split(':')[0] || 'Unknown'}`);
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
        
        // Ignore messages from the bot itself
        if (msg.key.fromMe) return;
        
        // Check if it's a status message
        if (remoteJid === 'status@broadcast') return;
        
        // Get message text
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
        
        // Only process if there's text
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
}

// Start the bot
console.log('🚀 Starting MARV-C V1 Bot...');
console.log('📱 Please scan the QR code with WhatsApp');
connectToWhatsApp().catch(err => {
    console.error('❌ Failed to start bot:', err);
});
