const config = require('./config');
const moment = require('moment');

// Format uptime
function getUptime(startTime) {
    const now = Date.now();
    const diff = now - startTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}hrs${String(minutes).padStart(2, '0')}min${String(seconds).padStart(2, '0')}sec`;
}

// Main menu buttons
function getMainMenu() {
    return {
        text: `*🤖 MARV-C AUTOMATION V1*\n━━━━━━━━━━━━━━━━━━━━━━\n_Main Menu_\n━━━━━━━━━━━━━━━━━━━━━━\nChoose an option below:`,
        buttons: [
            { buttonId: 'uptime', buttonText: { displayText: '⏰ Uptime' }, type: 1 },
            { buttonId: 'owner', buttonText: { displayText: '👤 Owner' }, type: 1 },
            { buttonId: 'botinfo', buttonText: { displayText: 'ℹ️ Bot Info' }, type: 1 },
            { buttonId: 'repo', buttonText: { displayText: '📦 Repo' }, type: 1 },
            { buttonId: 'sc', buttonText: { displayText: '📋 SC' }, type: 1 },
            { buttonId: 'antidelete', buttonText: { displayText: '🛡️ Anti-Delete' }, type: 1 },
        ],
        viewOnce: true,
        headerType: 1
    };
}

// Group menu buttons
function getGroupMenu() {
    return {
        text: `*👥 Group Menu*\n━━━━━━━━━━━━━━━━━━━━━━\n_Admin Commands_`,
        buttons: [
            { buttonId: 'groupinfo', buttonText: { displayText: 'ℹ️ Group Info' }, type: 1 },
            { buttonId: 'listmembers', buttonText: { displayText: '👥 Members' }, type: 1 },
            { buttonId: 'tagall', buttonText: { displayText: '📢 Tag All' }, type: 1 },
            { buttonId: 'left', buttonText: { displayText: '🚪 Leave' }, type: 1 },
            { buttonId: 'add', buttonText: { displayText: '➕ Add' }, type: 1 },
            { buttonId: 'kick', buttonText: { displayText: '❌ Kick' }, type: 1 },
        ],
        viewOnce: true,
        headerType: 1
    };
}

// Command handler
async function handleCommand(sock, remoteJid, command, msg, config, startTime) {
    const isGroup = remoteJid.endsWith('@g.us');
    const sender = msg.key.participant || msg.key.remoteJid;
    const isAdmin = await checkIfAdmin(sock, remoteJid, sender);
    
    // Split command and args
    const [cmd, ...args] = command.split(' ');
    
    // Main Menu
    if (cmd === 'help' || cmd === 'menu') {
        if (isGroup) {
            await sock.sendMessage(remoteJid, getGroupMenu());
        } else {
            await sock.sendMessage(remoteJid, getMainMenu());
        }
        return;
    }
    
    // Handle button clicks and commands
    switch(cmd) {
        case 'uptime':
            const uptime = getUptime(startTime);
            await sock.sendMessage(remoteJid, { 
                text: `⏰ *Bot Uptime*\n━━━━━━━━━━━━━━━━━━━━━━\n${uptime}` 
            });
            break;
            
        case 'owner':
            await sock.sendMessage(remoteJid, {
                text: `👤 *Owner Information*\n━━━━━━━━━━━━━━━━━━━━━━\n*Name:* ${config.OWNER_NAME}\n*WhatsApp:* ${config.OWNER_NUMBER}`
            });
            break;
            
        case 'botinfo':
            await sock.sendMessage(remoteJid, {
                text: `ℹ️ *Bot Information*\n━━━━━━━━━━━━━━━━━━━━━━\n${config.BOT_NAME} is a simple WhatsApp assistant that helps with small tasks.\n\n*Prefix:* ${config.PREFIX}\n*Status:* Online`
            });
            break;
            
        case 'repo':
            await sock.sendMessage(remoteJid, {
                text: `📦 *Repository*\n━━━━━━━━━━━━━━━━━━━━━━\n${config.REPO_LINK}`
            });
            break;
            
        case 'sc':
            await sock.sendMessage(remoteJid, {
                text: `📋 *Source Code*\n━━━━━━━━━━━━━━━━━━━━━━\n*Repo:* ${config.REPO_LINK}\n*Owner:* ${config.OWNER_NAME}\n*Number:* ${config.OWNER_NUMBER}\n\n━━━━━━━━━━━━━━━━━━━━━━\n✨ *Enjoy!* ✨`
            });
            break;
            
        case 'antidelete':
            if (!isGroup) {
                config.ANTI_DELETE = !config.ANTI_DELETE;
                await sock.sendMessage(remoteJid, {
                    text: `🛡️ *Anti-Delete*\n━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${config.ANTI_DELETE ? '✅ ON' : '❌ OFF'}`
                });
            }
            break;
            
        // Group Commands
        case 'groupinfo':
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(remoteJid);
                await sock.sendMessage(remoteJid, {
                    text: `ℹ️ *Group Information*\n━━━━━━━━━━━━━━━━━━━━━━\n*Name:* ${groupMetadata.subject}\n*Members:* ${groupMetadata.participants.length}\n*Owner:* ${groupMetadata.owner || 'Not available'}\n*Created:* ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}`
                });
            }
            break;
            
        case 'listmembers':
            if (isGroup && isAdmin) {
                const groupMetadata = await sock.groupMetadata(remoteJid);
                let memberList = '👥 *Group Members*\n━━━━━━━━━━━━━━━━━━━━━━\n';
                groupMetadata.participants.forEach((p, index) => {
                    memberList += `${index + 1}. @${p.id.split('@')[0]}\n`;
                });
                await sock.sendMessage(remoteJid, { 
                    text: memberList,
                    mentions: groupMetadata.participants.map(p => p.id)
                });
            }
            break;
            
        case 'tagall':
            if (isGroup && isAdmin) {
                const groupMetadata = await sock.groupMetadata(remoteJid);
                let tagMessage = '📢 *Tag All*\n━━━━━━━━━━━━━━━━━━━━━━\n';
                const mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(id => {
                    tagMessage += `@${id.split('@')[0]}\n`;
                });
                await sock.sendMessage(remoteJid, {
                    text: tagMessage,
                    mentions: mentions
                });
            }
            break;
            
        case 'tag':
            if (isGroup && isAdmin && args.length > 0) {
                // Find the user to tag
                const groupMetadata = await sock.groupMetadata(remoteJid);
                const targetUser = args[0];
                const user = groupMetadata.participants.find(p => 
                    p.id.includes(targetUser) || p.id.split('@')[0] === targetUser
                );
                if (user) {
                    await sock.sendMessage(remoteJid, {
                        text: `@${user.id.split('@')[0]} ${args.slice(1).join(' ') || ''}`,
                        mentions: [user.id]
                    });
                }
            }
            break;
            
        case 'left':
            if (isGroup && isAdmin) {
                await sock.groupLeave(remoteJid);
            }
            break;
            
        case 'add':
            if (isGroup && isAdmin && args.length > 0) {
                const number = args[0].replace('+', '');
                const jid = `${number}@s.whatsapp.net`;
                try {
                    await sock.groupParticipantsUpdate(remoteJid, [jid], 'add');
                    await sock.sendMessage(remoteJid, { 
                        text: `✅ Added ${args[0]} to the group` 
                    });
                } catch (error) {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ Failed to add ${args[0]}` 
                    });
                }
            }
            break;
            
        case 'kick':
            if (isGroup && isAdmin && args.length > 0) {
                const number = args[0].replace('+', '');
                const jid = `${number}@s.whatsapp.net`;
                try {
                    await sock.groupParticipantsUpdate(remoteJid, [jid], 'remove');
                    await sock.sendMessage(remoteJid, { 
                        text: `✅ Removed ${args[0]} from the group` 
                    });
                } catch (error) {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ Failed to remove ${args[0]}` 
                    });
                }
            }
            break;
            
        default:
            // Unknown command
            await sock.sendMessage(remoteJid, {
                text: `❌ Unknown command. Type *${config.PREFIX}help* for menu.`
            });
    }
}

// Helper function to check if user is admin
async function checkIfAdmin(sock, remoteJid, sender) {
    try {
        if (!remoteJid.endsWith('@g.us')) return false;
        const groupMetadata = await sock.groupMetadata(remoteJid);
        const participant = groupMetadata.participants.find(p => p.id === sender);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (error) {
        return false;
    }
}

module.exports = { handleCommand };
