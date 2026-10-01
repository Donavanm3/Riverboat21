'use strict';
// Adds the native project only if it doesn't exist yet (safe to run every build).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) throw new Error('usage: add-platform.js android|ios');
if (fs.existsSync(path.join(__dirname, '..', platform))) console.log(`${platform}/ already exists`);
else execSync(`npx cap add ${platform}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
