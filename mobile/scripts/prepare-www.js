'use strict';
// Copies the website (../docs) into www/ for the app and points it at the online server.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'docs');
const out = path.join(__dirname, '..', 'www');
const API = (process.env.RB21_API || 'https://riverboat21.onrender.com').replace(/\/$/, '');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.rmSync(path.join(out, 'sw.js'), { force: true }); // the app ships its files; no service worker needed
fs.writeFileSync(path.join(out, 'config.js'), `// Generated for the mobile app by scripts/prepare-www.js\nwindow.RB21_API = ${JSON.stringify(API)};\n`);
console.log(`www/ ready (server: ${API})`);
