const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    makeInMemoryStore,
    jidNormalizedUser,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const moment = require('moment');
const config = require('./config');
const { handleCommand } = require('./commands');

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent' }) });

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
        printQRInTerminal: true,
        browser: ['MARV-C V1', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
    });

    store.bind(sock.ev);

    // Set online presence
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('MARV-C V1 Bot is Online!');
            await updatePresence('available');
            startTime = Date.now();
        }
    });

    // Save credentials
    sock.ev.on('creds.update', saveCreds);

    // Message handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && !msg.key.remoteJid) return;
        
        const remoteJid = msg.key.remoteJid;
        const messageText = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || 
                           '';
        
        // Only respond to messages from personal inbox (not groups if not configured)
        const isGroup = remoteJid.endsWith('@g.us');
        const isOwner = remoteJid === `${config.OWNER_NUMBER}@s.whatsapp.net`;
        
        // For personal inbox, process all messages if from owner
        if (!isGroup && isOwner) {
            // Show typing indicator
            await sendTyping(remoteJid);
            
            // Check for commands
            if (messageText.startsWith(config.PREFIX)) {
                const command = messageText.slice(1).trim();
                await handleCommand(sock, remoteJid, command, msg, config, startTime);
            }
            
            // Handle anti-delete
            if (config.ANTI_DELETE && msg.message?.protocolMessage) {
                const deletedMsg = msg.message.protocolMessage.key;
                // Store deleted messages logic here
            }
        }
        
        // Group messages
        if (isGroup) {
            // Check if command
            if (messageText.startsWith(config.PREFIX)) {
                const command = messageText.slice(1).trim();
                await handleCommand(sock, remoteJid, command, msg, config, startTime);
            }
        }
    });

    return sock;
}

// Start the bot
connectToWhatsApp();
console.log('Starting MARV-C V1 Bot...');
