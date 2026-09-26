'use strict';
// End-to-end: boots the real server, registers players, plays a multiplayer hand over sockets,
// runs a tournament, and checks admin permissions and credit conservation.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb21-'));
Object.assign(process.env, { PORT: '0', DATA_FILE: path.join(dir, 'db.json'), JWT_SECRET: 'test', ADMIN_PASSWORD: 'adminpass123', BET_WINDOW_MS: '300', TURN_MS: '2000', RESULT_MS: '200', SIMULATE_ADS: 'true', PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', PAYPAL_API_BASE: 'http://127.0.0.1:0', ALLOWED_ORIGINS: 'https://deer.github.io' });
// ---- fake PayPal API ----
const http = require('http');
const pp = { orders: {}, refunds: [], n: 0, tamper: null };
const fakePayPal = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const capData = (o) => ({ id: o.id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-' + o.id, status: 'COMPLETED', amount: { currency_code: 'USD', value: o.value } }] } }] });
    let m;
    if (req.url === '/v1/oauth2/token') return send(200, { access_token: 'tok', expires_in: 3600 });
    if (req.url === '/v2/checkout/orders' && req.method === 'POST') {
      const b = JSON.parse(body); const id = 'ORD' + (++pp.n);
      pp.orders[id] = { id, value: b.purchase_units[0].amount.value, captured: false };
      return send(201, { id, status: 'CREATED' });
    }
    if ((m = req.url.match(/^\/v2\/checkout\/orders\/(\w+)\/capture$/))) {
      const o = pp.orders[m[1]]; if (!o) return send(404, { message: 'nope' });
      if (o.captured) return send(422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      o.captured = true; if (pp.tamper) { o.value = pp.tamper; pp.tamper = null; }
      return send(201, capData(o));
    }
    if ((m = req.url.match(/^\/v2\/checkout\/orders\/(\w+)$/))) return send(200, capData(pp.orders[m[1]]));
    if ((m = req.url.match(/^\/v2\/payments\/captures\/([\w-]+)\/refund$/))) { pp.refunds.push(m[1]); return send(201, { status: 'COMPLETED' }); }
    send(404, {});
  });
});

const { io } = require('socket.io-client');

let server, store;
(async () => {
  await new Promise((r) => fakePayPal.listen(0, r));
  process.env.PAYPAL_API_BASE = `http://127.0.0.1:${fakePayPal.address().port}`;
  ({ server, store } = require('../server'));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, body, token) => {
    const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const reg = async (email, name) => (await api('/api/auth/register', { email, name, password: 'password123' })).body;

  // Admin email is reserved and cannot be signed up.
  let r = await api('/api/auth/register', { email: 'McGuireDonavan8@Gmail.com', name: 'Imposter', password: 'password123' });
  assert.strictEqual(r.status, 400);
  const admin = (await api('/api/auth/login', { email: 'mcguiredonavan8@gmail.com', password: 'adminpass123' })).body;
  assert.ok(admin.user.admin, 'admin flag');
  const A = await reg('a@test.dev', 'Alice'); const B = await reg('b@test.dev', 'Bob');
  assert.strictEqual(A.user.credits, 1000); assert.strictEqual(A.user.admin, false);
  assert.strictEqual((await api('/api/admin/users', null, A.token)).status, 403);
  assert.strictEqual((await api('/api/admin/users', null, admin.token)).status, 200);

  // Free credit sources
  r = await api('/api/bonus/daily', {}, A.token); assert.strictEqual(r.body.credits, 1500);
  r = await api('/api/bonus/daily', {}, A.token); assert.strictEqual(r.status, 400);
  r = await api('/api/ads/reward', {}, A.token); assert.strictEqual(r.body.credits, 1650);
  r = await api('/api/ads/reward', {}, A.token); assert.strictEqual(r.status, 400, 'ad cooldown');
  assert.strictEqual((await api('/api/config')).body.paypalClientId, 'test-client');
  // CORS for the GitHub Pages front end
  let cr = await fetch(base + '/api/config', { headers: { Origin: 'https://deer.github.io' } });
  assert.strictEqual(cr.headers.get('access-control-allow-origin'), 'https://deer.github.io');
  cr = await fetch(base + '/api/config', { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(cr.headers.get('access-control-allow-origin'), null);

  // Multiplayer hand
  const connect = (tok) => new Promise((res, rej) => { const s = io(base, { auth: { token: tok }, transports: ['websocket'] }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
  const call = (s, ev, d) => new Promise((res, rej) => setTimeout(() => s.emit(ev, d, (x) => (x.error ? rej(new Error(x.error)) : res(x.data))), 100));
  const sa = await connect(A.token), sb = await connect(B.token);
  await call(sa, 'table:watch', { tableId: 't1' }); await call(sb, 'table:watch', { tableId: 't1' });
  await call(sa, 'table:sit', { tableId: 't1', seat: 0 }); await call(sb, 'table:sit', { tableId: 't1', seat: 2 });
  await assert.rejects(call(sb, 'table:sit', { tableId: 't1', seat: 0 }));
  await call(sa, 'table:bet', { tableId: 't1', amount: 100 }); await call(sb, 'table:bet', { tableId: 't1', amount: 50 });
  await assert.rejects(call(sa, 'table:bet', { tableId: 't1', amount: 100000 }), /max|credits/);
  const before = store.data.users[A.user.id].credits + store.data.users[A.user.id].escrow + store.data.users[B.user.id].credits + store.data.users[B.user.id].escrow;
  let state, sawPlay = false;
  sa.on('table', (t) => { state = t; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 150));
    if (!state) continue;
    if (state.phase === 'playing') {
      sawPlay = true;
      const cur = state.round.hands[state.round.turn];
      if (cur) { const s = cur.owner === A.user.id ? sa : sb; await call(s, 'table:act', { tableId: 't1', action: 'stand' }).catch(() => {}); }
    }
    if (state.phase === 'result' && (sawPlay || state.round)) break;
  }
  assert.strictEqual(state.phase, 'result', 'hand settled');
  const res = state.round.hands; const staked = res.reduce((s, h) => s + h.bet, 0), paid = res.reduce((s, h) => s + h.payout, 0);
  const after = store.data.users[A.user.id].credits + store.data.users[B.user.id].credits;
  assert.strictEqual(store.data.users[A.user.id].escrow + store.data.users[B.user.id].escrow, 0);
  assert.strictEqual(after, before - staked + paid, 'credits conserved');
  console.log('table hand:', res.map((h) => h.result).join(', '), 'dealer', state.round.dealer.total);

  // Tournament
  const ends = new Date(Date.now() + 3600e3).toISOString();
  r = await api('/api/admin/tournaments', { name: 'Friday Night', prizeType: 'credits', entryType: 'credits', entryFee: 200, prizeCredits: 1000, startingStack: 1000, hands: 5, minBet: 10, maxBet: 500, endsAt: ends }, admin.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); const tid = r.body.id;
  assert.strictEqual((await api('/api/admin/tournaments', { name: 'Nope', endsAt: ends }, A.token)).status, 403);
  const rules = 'NO PURCHASE NECESSARY. 18+, US residents, void where prohibited. Top stack wins.';
  let bad = await api('/api/admin/tournaments', { name: 'Cash paid', prizeType: 'cash', entryType: 'paid', entryPrice: 5, prizes: [{ description: '$100', value: 100 }], rules, endsAt: ends }, admin.token);
  assert.strictEqual(bad.status, 400, 'paid entry + real prize rejected'); assert.match(bad.body.error, /free to enter/);
  bad = await api('/api/admin/tournaments', { name: 'Cash credits', prizeType: 'item', entryType: 'credits', entryFee: 10, prizes: [{ description: 'Xbox' }], rules, endsAt: ends }, admin.token);
  assert.strictEqual(bad.status, 400, 'credit entry + real prize rejected');
  bad = await api('/api/admin/tournaments', { name: 'No rules', prizeType: 'cash', prizes: [{ description: '$50' }], endsAt: ends }, admin.token);
  assert.strictEqual(bad.status, 400, 'rules required');
  const cash = await api('/api/admin/tournaments', { name: 'Cash Cup', prizeType: 'cash', entryType: 'free', prizes: [{ description: '$100 PayPal', value: 100 }, { description: '$25 PayPal', value: 25 }], rules, hands: 5, endsAt: ends }, admin.token);
  assert.strictEqual(cash.status, 200, JSON.stringify(cash.body));
  assert.strictEqual((await api(`/api/tournaments/${cash.body.id}/join`, {}, A.token)).status, 400, 'must confirm eligibility');
  assert.strictEqual((await api(`/api/tournaments/${cash.body.id}/join`, { confirmEligible: true }, A.token)).status, 200);
  const paidT = await api('/api/admin/tournaments', { name: 'Paid Credits', prizeType: 'credits', prizeCredits: 50000, entryType: 'paid', entryPrice: 1.99, endsAt: ends }, admin.token);
  assert.strictEqual(paidT.body.entryPriceCents, 199);
  assert.strictEqual((await api(`/api/tournaments/${paidT.body.id}/join`, {}, A.token)).status, 400, 'paid needs checkout');
  // ---- PayPal: credit pack ----
  const order = async (tok, payload) => api('/api/paypal/orders', payload, tok);
  const capture = async (tok, id) => api(`/api/paypal/orders/${id}/capture`, {}, tok);
  const bBefore = store.data.users[B.user.id].credits;
  let o = await order(B.token, { kind: 'pack', packId: 'pack_5k' });
  assert.strictEqual(o.status, 200, JSON.stringify(o.body));
  assert.strictEqual(pp.orders[o.body.id].value, '0.99', 'server sets the price');
  assert.strictEqual((await capture(A.token, o.body.id)).status, 404, 'cannot capture someone else\'s order');
  let c = await capture(B.token, o.body.id);
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  assert.strictEqual(store.data.users[B.user.id].credits, bBefore + 5000);
  c = await capture(B.token, o.body.id);
  assert.strictEqual(c.body.already, true); assert.strictEqual(store.data.users[B.user.id].credits, bBefore + 5000, 'no double credit');
  // tampered amount -> refunded, no credits
  o = await order(B.token, { kind: 'pack', packId: 'pack_30k' }); pp.tamper = '0.01';
  c = await capture(B.token, o.body.id);
  assert.strictEqual(c.status, 400); await new Promise((r) => setTimeout(r, 150)); assert.ok(pp.refunds.includes('CAP-' + o.body.id));
  assert.strictEqual(store.data.users[B.user.id].credits, bBefore + 5000);

  // ---- PayPal: paid tournament entry ----
  assert.strictEqual((await order(B.token, { kind: 'tournament', tournamentId: paidT.body.id })).status, 400, 'terms required');
  o = await order(B.token, { kind: 'tournament', tournamentId: paidT.body.id, confirmTerms: true });
  assert.strictEqual(pp.orders[o.body.id].value, '1.99');
  c = await capture(B.token, o.body.id);
  assert.strictEqual(c.status, 200); assert.ok(store.data.tournaments[paidT.body.id].entries[B.user.id], 'entered after capture');
  assert.strictEqual((await order(B.token, { kind: 'tournament', tournamentId: paidT.body.id, confirmTerms: true })).status, 400, 'no double entry');
  // tournament fills between order and capture -> refund
  const small = await api('/api/admin/tournaments', { name: 'Tiny', prizeType: 'credits', entryType: 'paid', entryPrice: 1, maxEntrants: 2, endsAt: ends }, admin.token);
  const oA = await order(A.token, { kind: 'tournament', tournamentId: small.body.id, confirmTerms: true });
  const oB = await order(B.token, { kind: 'tournament', tournamentId: small.body.id, confirmTerms: true });
  await capture(admin.token, (await order(admin.token, { kind: 'tournament', tournamentId: small.body.id, confirmTerms: true })).body.id);
  await capture(A.token, oA.body.id);
  c = await capture(B.token, oB.body.id);
  assert.match(c.body.message, /refunded/); await new Promise((r) => setTimeout(r, 150)); assert.ok(pp.refunds.includes('CAP-' + oB.body.id));
  // cancelling a paid tournament refunds everyone
  await api(`/api/admin/tournaments/${small.body.id}/cancel`, {}, admin.token);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(pp.refunds.includes('CAP-' + oA.body.id), 'cancel refunds');

  // Credit tournament: entry fee, play out, pool paid
  const aCredits = store.data.users[A.user.id].credits;
  assert.strictEqual((await api(`/api/tournaments/${tid}/join`, {}, A.token)).status, 200);
  assert.strictEqual(store.data.users[A.user.id].credits, aCredits - 200);
  assert.strictEqual((await api(`/api/tournaments/${tid}/join`, {}, A.token)).status, 400, 'no double entry');
  await api(`/api/tournaments/${tid}/join`, {}, B.token);
  for (const s of [sa, sb]) {
    for (let h = 0; h < 5; h++) {
      let d = await call(s, 'tour:deal', { id: tid, bet: 100 }).catch((e) => e);
      if (d instanceof Error) break;
      while (d.round.phase === 'playing') d = await call(s, 'tour:act', { id: tid, action: 'stand' });
    }
  }
  await assert.rejects(call(sa, 'tour:deal', { id: tid, bet: 100 }), /all your hands|chips/);
  r = await api(`/api/admin/tournaments/${tid}/finish`, {}, admin.token);
  const totalPrize = r.body.winners.reduce((s, w) => s + w.prizeCredits, 0);
  assert.ok(totalPrize <= 1400 && totalPrize >= 1398, 'pool paid out');
  console.log('tournament winners:', r.body.winners.map((w) => `${w.name} ${w.stack} -> ${w.prizeCredits}`).join(' | '));

  // Real-prize tournament finish + prize tracking
  let d = await call(sa, 'tour:deal', { id: cash.body.id, bet: 100 });
  while (d.round.phase === 'playing') d = await call(sa, 'tour:act', { id: cash.body.id, action: 'stand' });
  r = await api(`/api/admin/tournaments/${cash.body.id}/finish`, {}, admin.token);
  assert.strictEqual(r.body.winners[0].prize, '$100 PayPal'); assert.strictEqual(r.body.winners[0].email, 'a@test.dev');
  assert.strictEqual(r.body.winners.length, 1);
  r = await api(`/api/admin/tournaments/${cash.body.id}/prize`, { place: 1, status: 'sent' }, admin.token);
  assert.strictEqual(r.body.winners[0].prizeStatus, 'sent');
  const pub = (await api('/api/tournaments', null, B.token)).body.find((t) => t.id === cash.body.id);
  assert.strictEqual(pub.winners[0].email, undefined, 'emails hidden from players');

  // Admin credit adjust and suspend
  r = await api(`/api/admin/users/${B.user.id}/credits`, { amount: 5000 }, admin.token); assert.strictEqual(r.status, 200);
  r = await api(`/api/admin/users/${B.user.id}/ban`, { banned: true }, admin.token); assert.strictEqual(r.body.banned, true);
  assert.strictEqual((await api('/api/me', null, B.token)).status, 401);

  sa.close(); sb.close(); store.flush();
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).users[A.user.id]);
  console.log('smoke ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
