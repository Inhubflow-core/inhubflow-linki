const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'public', 'logo-icon.png');
const outDir = path.join(__dirname, '..', 'extension', 'icons');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Copy source icon to icon16, icon48, icon128
fs.copyFileSync(src, path.join(outDir, 'icon16.png'));
fs.copyFileSync(src, path.join(outDir, 'icon48.png'));
fs.copyFileSync(src, path.join(outDir, 'icon128.png'));

console.log('Icons generated successfully in extension/icons/');
