const config = require('./config');

const settings = {
    packname: config.BOT_NAME,
    author: config.OWNER_NAME,
    botName: config.BOT_NAME,
    botOwner: config.OWNER_NAME,
    ownerNumber: config.OWNER_NUMBER,
    commandMode: "public",
    maxStoreMessages: 20,
    storeWriteInterval: 10000,
    version: config.VERSION,
};

module.exports = settings;
