const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const extDir = path.join(__dirname, '..', 'extension');
const outDir = path.join(__dirname, '..', 'public', 'extension');
const zipPath = path.join(outDir, 'inhubflow-connect.zip');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Use PowerShell Compress-Archive on Windows
const cmd = `powershell -Command "Compress-Archive -Path '${extDir}\\*' -DestinationPath '${zipPath}' -Force"`;
console.log('Packaging extension to ZIP...');
execSync(cmd, { stdio: 'inherit' });
console.log('Extension packaged successfully at:', zipPath);
