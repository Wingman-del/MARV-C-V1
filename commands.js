const config = require('./config');

function getUptime(startTime) {
    const now = Date.now();
    const diff = now - startTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}hrs${String(minutes).padStart(2, '0')}min${String(seconds).padStart(2, '0')}sec`;
}

function getMenuText(prefix) {
    let menuText = `*🤖 MARV-C V1 - MAIN MENU*\n`;
    menuText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    menuText += `📋 *Basic Commands:*\n`;
    menuText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    menuText += `⏰ *${prefix}uptime* - Show bot uptime\n`;
    menuText += `👤 *${prefix}owner* - Show owner info\n`;
    menuText += `ℹ️ *${prefix}botinfo* - Show bot info\n`;
    menuText += `📦 *${prefix}repo* - Show repository\n`;
    menuText += `📋 *${prefix}sc* - Show source code\n`;
    menuText += `🛡️ *${prefix}antidelete* - Toggle anti-delete\n`;
    menuText += `❓ *${prefix}help* - Show this menu\n\n`;
    menuText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    menuText += `👥 *Group Admin Commands:*\n`;
    menuText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    menuText += `ℹ️ *${prefix}groupinfo* - Show group info\n`;
    menuText += `👥 *${prefix}listmembers* - List all members\n`;
    menuText += `📢 *${prefix}tagall* - Tag all members\n`;
    menuText += `📢 *${prefix}tag @user* - Tag specific user\n`;
    menuText += `🚪 *${prefix}left* - Leave group\n`;
    menuText += `➕ *${prefix}add number* - Add member\n`;
    menuText += `❌ *${prefix}kick number* - Remove member\n\n`;
    menuText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    menuText += `💡 *Tip:* Send ${prefix}help to show this menu anytime`;
    return menuText;
}

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

async function handleCommand(sock, remoteJid, command, msg, config, startTime) {
    console.log(`🔄 Processing command: ${command}`);
    
    const isGroup = remoteJid.endsWith('@g.us');
    const sender = msg.key.participant || msg.key.remoteJid;
    const isAdmin = await checkIfAdmin(sock, remoteJid, sender);
    
    const [cmd, ...args] = command.split(' ');
    console.log(`📋 Command: ${cmd}, Args: ${args}`);
    
    // Main Menu - Help Command
    if (cmd === 'help' || cmd === 'menu') {
        console.log('📋 Showing menu');
        const menuText = getMenuText(config.PREFIX);
        await sock.sendMessage(remoteJid, { text: menuText });
        return;
    }
    
    switch(cmd) {
        case 'ping':
            console.log('🏓 Pong!');
            await sock.sendMessage(remoteJid, { text: '🏓 Pong!' });
            break;
            
        case 'uptime':
            const uptime = getUptime(startTime);
            console.log(`⏰ Uptime: ${uptime}`);
            await sock.sendMessage(remoteJid, { 
                text: `⏰ *Bot Uptime*\n━━━━━━━━━━━━━━━━━━━━━━\n${uptime}` 
            });
            break;
            
        case 'owner':
            console.log('👤 Showing owner');
            await sock.sendMessage(remoteJid, {
                text: `👤 *Owner Information*\n━━━━━━━━━━━━━━━━━━━━━━\n*Name:* ${config.OWNER_NAME}\n*WhatsApp:* ${config.OWNER_NUMBER}`
            });
            break;
            
        case 'botinfo':
            console.log('ℹ️ Showing bot info');
            await sock.sendMessage(remoteJid, {
                text: `ℹ️ *Bot Information*\n━━━━━━━━━━━━━━━━━━━━━━\n${config.BOT_NAME} is a simple WhatsApp assistant that helps with small tasks.\n\n*Prefix:* ${config.PREFIX}\n*Status:* Online 🟢\n*Uptime:* ${getUptime(startTime)}`
            });
            break;
            
        case 'repo':
            console.log('📦 Showing repo');
            await sock.sendMessage(remoteJid, {
                text: `📦 *Repository*\n━━━━━━━━━━━━━━━━━━━━━━\n${config.REPO_LINK}`
            });
            break;
            
        case 'sc':
            console.log('📋 Showing source code');
            await sock.sendMessage(remoteJid, {
                text: `📋 *Source Code*\n━━━━━━━━━━━━━━━━━━━━━━\n*Repo:* ${config.REPO_LINK}\n*Owner:* ${config.OWNER_NAME}\n*Number:* ${config.OWNER_NUMBER}\n\n━━━━━━━━━━━━━━━━━━━━━━\n✨ *Enjoy!* ✨`
            });
            break;
            
        case 'antidelete':
            if (!isGroup) {
                config.ANTI_DELETE = !config.ANTI_DELETE;
                console.log(`🛡️ Anti-Delete toggled: ${config.ANTI_DELETE}`);
                await sock.sendMessage(remoteJid, {
                    text: `🛡️ *Anti-Delete*\n━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${config.ANTI_DELETE ? '✅ ON' : '❌ OFF'}`
                });
            }
            break;
            
        // Group Commands
        case 'groupinfo':
            if (isGroup) {
                try {
                    const groupMetadata = await sock.groupMetadata(remoteJid);
                    await sock.sendMessage(remoteJid, {
                        text: `ℹ️ *Group Information*\n━━━━━━━━━━━━━━━━━━━━━━\n*Name:* ${groupMetadata.subject}\n*Members:* ${groupMetadata.participants.length}\n*Owner:* ${groupMetadata.owner || 'Not available'}\n*Created:* ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}`
                    });
                } catch (error) {
                    await sock.sendMessage(remoteJid, { text: '❌ Failed to get group info' });
                }
            }
            break;
            
        case 'listmembers':
            if (isGroup) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: '❌ Only admins can use this command' });
                    break;
                }
                try {
                    const groupMetadata = await sock.groupMetadata(remoteJid);
                    let memberList = '👥 *Group Members*\n━━━━━━━━━━━━━━━━━━━━━━\n';
                    const mentions = [];
                    groupMetadata.participants.forEach((p, index) => {
                        const name = p.id.split('@')[0];
                        memberList += `${index + 1}. @${name}\n`;
                        mentions.push(p.id);
                    });
                    await sock.sendMessage(remoteJid, { 
                        text: memberList,
                        mentions: mentions
                    });
                } catch (error) {
                    await sock.sendMessage(remoteJid, { text: '❌ Failed to list members' });
                }
            }
            break;
            
        case 'tagall':
            if (isGroup) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: '❌ Only admins can use this command' });
                    break;
                }
                try {
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
                } catch (error) {
                    await sock.sendMessage(remoteJid, { text: '❌ Failed to tag all' });
                }
            }
            break;
            
        case 'tag':
            if (isGroup && args.length > 0) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: '❌ Only admins can use this command' });
                    break;
                }
                try {
                    const groupMetadata = await sock.groupMetadata(remoteJid);
                    const targetUser = args[0].replace('@', '');
                    const user = groupMetadata.participants.find(p => 
                        p.id.includes(targetUser) || p.id.split('@')[0] === targetUser
                    );
                    if (user) {
                        const message = args.slice(1).join(' ') || 'Hello!';
                        await sock.sendMessage(remoteJid, {
                            text: `@${user.id.split('@')[0]} ${message}`,
                            mentions: [user.id]
                        });
                    } else {
                        await sock.sendMessage(remoteJid, { text: '❌ User not found in group' });
                    }
                } catch (error) {
                    await sock.sendMessage(remoteJid, { text: '❌ Failed to tag user' });
                }
            }
            break;
            
        case 'left':
            if (isGroup) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: '❌ Only admins can use this command' });
                    break;
                }
                try {
                    await sock.groupLeave(remoteJid);
                } catch (error) {
                    await sock.sendMessage(remoteJid, { text: '❌ Failed to leave group' });
                }
            }
            break;
            
        case 'add':
            if (isGroup && args.length > 0) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: '❌ Only admins can use this command' });
                    break;
                }
                const number = args[0].replace('+', '').replace(/\s/g, '');
                const jid = `${number}@s.whatsapp.net`;
                try {
                    await sock.groupParticipantsUpdate(remoteJid, [jid], 'add');
                    await sock.sendMessage(remoteJid, { 
                        text: `✅ Added ${args[0]} to the group` 
                    });
                } catch (error) {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ Failed to add ${args[0]}. Make sure the number is valid and has WhatsApp.` 
                    });
                }
            }
            break;
            
        case 'kick':
            if (isGroup && args.length > 0) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: '❌ Only admins can use this command' });
                    break;
                }
                const number = args[0].replace('+', '').replace(/\s/g, '');
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
            console.log(`❌ Unknown command: ${cmd}`);
            await sock.sendMessage(remoteJid, {
                text: `❌ Unknown command. Type *${config.PREFIX}help* for menu.`
            });
    }
}

module.exports = { handleCommand, getMenuText };
