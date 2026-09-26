'use strict';
// Checks that game state survives a full restart when stored in Postgres (free hosts with no disk).
// Runs only when TEST_DATABASE_URL points at a disposable Postgres database.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const url = process.env.TEST_DATABASE_URL;
if (!url) { console.log('pg test skipped (set TEST_DATABASE_URL to run)'); process.exit(0); }

const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
function boot() {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'start.js')], {
    env: { ...process.env, DATABASE_URL: url, PORT: String(port), JWT_SECRET: 'pgtest', ADMIN_PASSWORD: 'adminpass123', DATA_FILE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('boot timeout\n' + log)), 15000);
    p.stdout.on('data', () => { if (log.includes('running on port')) { clearTimeout(t); res({ p, log: () => log }); } });
  });
}
const stop = (s) => new Promise((r) => { s.p.on('exit', r); s.p.kill('SIGTERM'); });
const api = async (p, body, token) => {
  const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

(async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  await pool.query('DROP TABLE IF EXISTS rb21_state');

  let s = await boot();
  assert.match(s.log(), /starting fresh/);
  const reg = await api('/api/auth/register', { email: 'keep@test.dev', name: 'Keeper', password: 'password123' });
  assert.strictEqual(reg.status, 200);
  await api('/api/bonus/daily', {}, reg.body.token);
  await stop(s);

  const row = await pool.query('SELECT data FROM rb21_state WHERE id = 1');
  assert.ok(Object.values(row.rows[0].data.users).some((u) => u.email === 'keep@test.dev'), 'saved to database');

  s = await boot();
  assert.match(s.log(), /loaded saved game state/);
  const login = await api('/api/auth/login', { email: 'keep@test.dev', password: 'password123' });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.user.credits, 1500, 'credits survived restart');
  assert.strictEqual((await api('/api/auth/login', { email: 'mcguiredonavan8@gmail.com', password: 'adminpass123' })).body.user.admin, true);
  await stop(s);
  await pool.end();
  console.log('pg persistence ok');
})().catch((e) => { console.error(e); process.exit(1); });
