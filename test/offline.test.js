'use strict';
// Runs the browser offline bundle (docs/engine.js + docs/offline.js) in a simulated window.
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { webcrypto } = require('crypto');

function makeWindow(storage) {
  const win = {
    crypto: webcrypto, setTimeout, clearTimeout, console, JSON, Date, Math,
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } },
    addEventListener() {},
  };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of ['engine.js', 'offline.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8'), ctx, { filename: f });
  return win;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const storage = {};
  let w = makeWindow(storage);
  let off = w.RB21Offline.init();
  const cfg = await off.api('/api/config'); assert.strictEqual(cfg.offline, true); assert.strictEqual(cfg.storeEnabled, false);
  let me = await off.api('/api/me'); assert.strictEqual(me.credits, 1000);
  me = await off.api('/api/bonus/daily', {}); assert.strictEqual(me.credits, 1500);
  await assert.rejects(off.api('/api/bonus/daily', {}), /not ready/);
  await assert.rejects(off.api('/api/admin/users'), /offline/);
  assert.deepStrictEqual(await off.api('/api/tournaments'), []);

  let r = await off.api('/api/games/roulette', { bets: [{ type: 'red', amount: 10 }] });
  assert.strictEqual(r.credits, 1500 - 10 + r.payout);
  await wait(320);
  r = await off.api('/api/games/slots', { bet: 25 }); assert.strictEqual(r.grid.length, 3);
  await wait(320);
  const d = await off.api('/api/games/poker/deal', { bet: 20 }); assert.strictEqual(d.hand.length, 5);

  // Blackjack against the dealer through the local socket
  const sock = off.socket(); let state = null;
  sock.on('table', (t) => { state = t; });
  const call = (ev, data) => new Promise((res, rej) => sock.emit(ev, data, (x) => (x.error ? rej(new Error(x.error)) : res(x.data))));
  await call('table:watch', { tableId: 't1' });
  await call('table:sit', { tableId: 't1', seat: 2 });
  await call('table:bet', { tableId: 't1', amount: 50 });
  for (let i = 0; i < 100 && !(state && state.phase === 'result'); i++) {
    await wait(100);
    if (state && state.phase === 'playing' && state.round.turn >= 0) await call('table:act', { tableId: 't1', action: 'stand' }).catch(() => {});
  }
  assert.strictEqual(state.phase, 'result', 'offline hand finished');
  const h = state.round.hands[0];
  console.log('offline blackjack:', h.result, 'payout', h.payout);

  // Reload the page mid video-poker hand: saved credits persist and the escrowed bet comes back
  await wait(300);
  const saved = JSON.parse(storage.rb21_offline_v1);
  assert.strictEqual(saved.user.escrow, 20, 'poker bet in escrow');
  w = makeWindow(storage); off = w.RB21Offline.init();
  me = await off.api('/api/me');
  assert.strictEqual(me.escrow, 0);
  assert.strictEqual(me.credits, saved.user.credits + 20, 'escrow refunded after reload');
  console.log('offline ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
