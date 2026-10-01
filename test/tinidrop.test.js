'use strict';
// Checks the TiniDrop packer and uploader against a fake TiniDrop API.
const assert = require('assert');
const http = require('http');
const { unzipSync, strFromU8 } = require('fflate');
const { packSite } = require('../scripts/pack-site');
const { deploy } = require('../scripts/deploy-tinidrop');

(async () => {
  const files = unzipSync(new Uint8Array(packSite({ api: 'https://example.onrender.com/' })));
  for (const f of ['index.html', 'app.js', 'games.js', 'games2.js', 'engine.js', 'offline.js', 'style.css', 'manifest.webmanifest']) assert.ok(files[f], f + ' at zip root');
  assert.match(strFromU8(files['config.js']), /"https:\/\/example\.onrender\.com"/);
  assert.ok(!Object.keys(files).some((k) => k.startsWith('docs/')), 'no docs/ folder prefix');

  const seen = [];
  const fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], type: req.headers['content-type'], body });
      if (req.headers['x-api-key'] !== 'td_test') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"Invalid API key"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ slug: 'riverboat21', liveSiteUrl: 'https://riverboat21.tinidrop.app/', isZipSite: true }));
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const apiUrl = `http://127.0.0.1:${fake.address().port}`;

  let r = await deploy({ apiKey: 'td_test', apiUrl });
  assert.strictEqual(r.slug, 'riverboat21');
  assert.strictEqual(seen[0].method, 'POST'); assert.strictEqual(seen[0].url, '/api/upload');
  assert.match(seen[0].type, /multipart\/form-data/);
  assert.ok(seen[0].body.includes(Buffer.from('filename="riverboat21-site.zip"')));
  r = await deploy({ apiKey: 'td_test', apiUrl, slug: 'riverboat21' });
  assert.strictEqual(seen[1].method, 'PUT'); assert.ok(seen[1].body.includes(Buffer.from('name="slug"')));
  await assert.rejects(deploy({ apiKey: 'wrong', apiUrl }), /Invalid API key/);
  await assert.rejects(deploy({ apiUrl }), /Missing TINIDROP_API_KEY/);
  fake.close();
  console.log('tinidrop ok');
})().catch((e) => { console.error(e); process.exit(1); });
