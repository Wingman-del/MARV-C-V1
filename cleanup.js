const fs = require('fs');
const path = require('path');

console.log('🧹 Running cleanup...');

// Clean temp folder
const tempDir = './temp';
if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('✅ Temp folder cleaned');
}

// Clean old logs
const logDir = './logs';
if (fs.existsSync(logDir)) {
    fs.rmSync(logDir, { recursive: true, force: true });
    console.log('✅ Logs folder cleaned');
}

console.log('✅ Cleanup complete!');
