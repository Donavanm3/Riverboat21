'use strict';
// Packs the website (docs/) into a ZIP with index.html at the top level, ready for any static host
// (TiniDrop, Netlify Drop, tiiny.host, ...). Usage: npm run pack:site   -> dist/riverboat21-site.zip
// Set RB21_API to bake in a different game-server address.
const fs = require('fs');
const path = require('path');
const { zipSync } = require('fflate');

function collect(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) collect(full, base, out);
    else out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full);
  }
  return out;
}
function packSite({ api } = {}) {
  const files = collect(path.join(__dirname, '..', 'docs'));
  if (api) files['config.js'] = Buffer.from(`// Set by scripts/pack-site.js\nwindow.RB21_API = ${JSON.stringify(api.replace(/\/$/, ''))};\n`);
  if (!files['index.html']) throw new Error('docs/index.html missing');
  return Buffer.from(zipSync(files, { level: 9 }));
}
module.exports = { packSite };
if (require.main === module) {
  const out = path.join(__dirname, '..', 'dist', 'riverboat21-site.zip');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = packSite({ api: process.env.RB21_API });
  fs.writeFileSync(out, buf);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(buf.length / 1024).toFixed(0)} KB)`);
}
