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
const logDir = './logs
