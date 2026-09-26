'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Store } = require('./lib/store');
const { Wallet } = require('./lib/wallet');
const { TableManager } = require('./lib/tables');
const { Tournaments } = require('./lib/tournaments');
const { ECONOMY, CREDIT_PACKS, TABLES } = require('./lib/config');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Where players open the game (e.g. your GitHub Pages site). Allowed to call this server (CORS).
const CLIENT_URL = (process.env.CLIENT_URL || PUBLIC_URL).replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set([PUBLIC_URL, CLIENT_URL, ...String(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean)]
  .map((u) => { try { return new URL(u).origin; } catch { return u; } }));
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'mcguiredonavan8@gmail.com').trim().toLowerCase();
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[warn] JWT_SECRET not set: using a random secret, everyone is signed out on restart.');
  return crypto.randomBytes(32).toString('hex');
})();
const { PayPal } = require('./lib/paypal');
const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
const paypal = process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
  ? new PayPal({ clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, env: PAYPAL_ENV, base: process.env.PAYPAL_API_BASE })
  : null;

const store = new Store(process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));
store.remote = global.__RB21_REMOTE || null; // set by start.js when DATABASE_URL is used
const D = store.data;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const isAdmin = (u) => !!u && u.email === ADMIN_EMAIL;

// ---- admin account: created from env, the admin email can never be claimed through sign-up ----
if (!D.emailIndex[ADMIN_EMAIL] && process.env.ADMIN_PASSWORD) {
  const id = crypto.randomUUID();
  D.users[id] = { id, email: ADMIN_EMAIL, name: process.env.ADMIN_NAME || 'Admin', hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10), credits: 100000, escrow: 0, createdAt: Date.now() };
  D.emailIndex[ADMIN_EMAIL] = id;
  console.log(`[admin] created admin account ${ADMIN_EMAIL}`);
} else if (!D.emailIndex[ADMIN_EMAIL]) {
  console.warn('[warn] ADMIN_PASSWORD not set and no admin account exists yet. Set it to create the admin.');
}
store.save();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)), methods: ['GET', 'POST'] } });

const wallet = new Wallet(store, (uid) => {
  const u = D.users[uid];
  if (u) io.to('user:' + uid).emit('wallet', { credits: u.credits, escrow: u.escrow || 0 });
});
const tables = new TableManager(TABLES, { wallet, onChange: (t) => { io.to('table:' + t.id).emit('table', t.view()); io.to('lobby').emit('tables', tables.list()); } });
const tours = new Tournaments(store, wallet, () => io.to('lobby').emit('tournaments:changed'));
setInterval(() => tours.tick(), 15000).unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'docs')));

// ---- helpers ----
const sign = (u) => jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: '7d' });
function userFromToken(token) {
  try { const { uid } = jwt.verify(token, JWT_SECRET); const u = D.users[uid]; return u && !u.banned ? u : null; }
  catch { return null; }
}
function auth(req, res, next) {
  const u = userFromToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!u) return res.status(401).json({ error: 'Sign in again' });
  req.user = u; next();
}
function admin(req, res, next) { if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' }); next(); }
const wrap = (fn) => (req, res) => { try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { res.status(400).json({ error: e.message }); } };
const me = (u) => ({ id: u.id, email: u.email, name: u.name, credits: u.credits, escrow: u.escrow || 0, admin: isAdmin(u), stats: u.stats || null,
  nextDaily: (u.lastDaily || 0) + ECONOMY.dailyCooldownMs, nextAd: (u.lastAd || 0) + ECONOMY.adCooldownMs });

const attempts = new Map();
function throttle(key, max = 10, windowMs = 15 * 60000) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) throw new Error('Too many attempts. Try again in a few minutes.');
  a.push(now); attempts.set(key, a);
}

// ---- public config ----
app.get('/api/config', (req, res) => res.json({
  adsenseClient: process.env.ADSENSE_CLIENT || '',
  adsenseBannerSlot: process.env.ADSENSE_BANNER_SLOT || '',
  adsTestMode: process.env.ADS_TEST_MODE === 'true',
  simulateAds: process.env.SIMULATE_ADS === 'true',
  storeEnabled: !!paypal, paypalClientId: paypal ? process.env.PAYPAL_CLIENT_ID : '', paypalEnv: PAYPAL_ENV, packs: CREDIT_PACKS, economy: ECONOMY,
}));

// ---- auth ----
app.post('/api/auth/register', wrap((req) => {
  throttle('reg:' + req.ip, 5, 60 * 60000);
  const email = normEmail(req.body.email), password = String(req.body.password || '');
  const name = String(req.body.name || '').replace(/[^\w .'-]/g, '').trim().slice(0, 20);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email');
  if (email === ADMIN_EMAIL) throw new Error('This email is reserved. Sign in instead.');
  if (name.length < 2) throw new Error('Pick a display name (2 to 20 characters)');
  if (password.length < 8) throw new Error('Password needs at least 8 characters');
  if (D.emailIndex[email]) throw new Error('That email already has an account');
  const id = crypto.randomUUID();
  D.users[id] = { id, email, name, hash: bcrypt.hashSync(password, 10), credits: ECONOMY.signupBonus, escrow: 0, createdAt: Date.now() };
  D.emailIndex[email] = id; store.save();
  return { token: sign(D.users[id]), user: me(D.users[id]) };
}));
app.post('/api/auth/login', wrap((req) => {
  const email = normEmail(req.body.email);
  throttle('login:' + req.ip + ':' + email);
  const u = D.users[D.emailIndex[email]];
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.hash)) throw new Error('Email or password is wrong');
  if (u.banned) throw new Error('This account is suspended');
  return { token: sign(u), user: me(u) };
}));
app.get('/api/me', auth, (req, res) => res.json(me(req.user)));

// ---- free credits ----
app.post('/api/bonus/daily', auth, wrap((req) => {
  const u = req.user, now = Date.now();
  if (now < (u.lastDaily || 0) + ECONOMY.dailyCooldownMs) throw new Error('Daily bonus is not ready yet');
  u.lastDaily = now; wallet.credit(u.id, ECONOMY.dailyBonus);
  return me(u);
}));
app.post('/api/bonus/refill', auth, wrap((req) => {
  const u = req.user, now = Date.now();
  if (u.credits + (u.escrow || 0) >= ECONOMY.refillThreshold) throw new Error('Refills are for empty wallets');
  if (now < (u.lastRefill || 0) + ECONOMY.refillCooldownMs) throw new Error('Refill is on cooldown');
  u.lastRefill = now; wallet.credit(u.id, ECONOMY.refillAmount);
  return me(u);
}));
app.post('/api/ads/reward', auth, wrap((req) => {
  const u = req.user, now = Date.now(), day = new Date().toISOString().slice(0, 10);
  if (!process.env.ADSENSE_CLIENT && process.env.SIMULATE_ADS !== 'true') throw new Error('Ads are not set up');
  if (u.adDay !== day) { u.adDay = day; u.adsToday = 0; }
  if (u.adsToday >= ECONOMY.adDailyCap) throw new Error('Daily ad limit reached');
  if (now < (u.lastAd || 0) + ECONOMY.adCooldownMs) throw new Error('Next ad reward is not ready yet');
  u.lastAd = now; u.adsToday++; wallet.credit(u.id, ECONOMY.adReward);
  return me(u);
}));

// ---- store ----
// ---- tournaments ----
app.get('/api/tournaments', auth, wrap((req) => Object.values(tours.all())
  .filter((t) => t.status !== 'cancelled')
  .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.createdAt - a.createdAt)
  .slice(0, 30).map((t) => tours.publicView(t, req.user.id, isAdmin(req.user)))));
app.post('/api/tournaments/:id/join', auth, wrap((req) => { tours.join(req.params.id, req.user.id, { confirmEligible: req.body.confirmEligible === true }); return tours.publicView(tours.get(req.params.id), req.user.id); }));

// ---- PayPal checkout ----
// 1. Browser asks for an order (we fix the price server-side).  2. Buyer approves in the PayPal popup.
// 3. Browser asks us to capture. We capture with PayPal, check the amount, then grant credits or the entry.
D.orders = D.orders || {};
app.post('/api/paypal/orders', auth, async (req, res) => {
  if (!paypal) return res.status(400).json({ error: 'Payments are not set up yet' });
  try {
    let item;
    if (req.body.kind === 'pack') {
      const pack = CREDIT_PACKS.find((p) => p.id === req.body.packId);
      if (!pack) throw new Error('Unknown pack');
      item = { kind: 'pack', packId: pack.id, amountCents: pack.priceCents, description: `${pack.credits.toLocaleString()} Riverboat 21 play credits (no cash value)` };
    } else if (req.body.kind === 'tournament') {
      const t = tours.get(req.body.tournamentId);
      if (t.entryType !== 'paid') throw new Error('This tournament is not paid entry');
      tours.canJoin(t, req.user.id);
      if (req.body.confirmTerms !== true) throw new Error('Accept the tournament terms first');
      item = { kind: 'tournament', tournamentId: t.id, amountCents: t.entryPriceCents, description: `Tournament entry: ${t.name} (play-credit prizes)` };
    } else throw new Error('Unknown purchase');
    const local = crypto.randomUUID();
    const order = await paypal.createOrder({ amountCents: item.amountCents, description: item.description, referenceId: item.kind, customId: req.user.id, requestId: local });
    D.orders[order.id] = { ...item, uid: req.user.id, status: 'created', at: Date.now() };
    store.save();
    res.json({ id: order.id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
const capturing = new Set();
app.post('/api/paypal/orders/:id/capture', auth, async (req, res) => {
  const id = req.params.id, o = D.orders[id];
  if (!paypal || !o || o.uid !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  if (o.status === 'captured') return res.json({ ok: true, user: me(req.user), already: true });
  if (capturing.has(id)) return res.status(409).json({ error: 'Payment is already being processed' });
  capturing.add(id);
  try {
    const cap = await paypal.capture(id);
    if (cap.status !== 'COMPLETED') { o.status = 'failed:' + cap.status; store.save(); throw new Error(cap.status === 'PENDING' ? 'PayPal is holding this payment for review. Credits arrive once it clears; contact support if not.' : 'Payment did not complete'); }
    if (cap.amountCents !== o.amountCents || cap.currency !== 'USD') {
      o.status = 'amount_mismatch'; store.save();
      paypal.refund(cap.captureId).catch((e) => console.error('[refund failed]', cap.captureId, e.message));
      throw new Error('Payment amount did not match. You have been refunded.');
    }
    o.status = 'captured'; o.captureId = cap.captureId; o.capturedAt = Date.now();
    const pay = { uid: o.uid, kind: o.kind, amount: o.amountCents, captureId: cap.captureId, orderId: id, at: Date.now() };
    let message;
    if (o.kind === 'pack') {
      const pack = CREDIT_PACKS.find((p) => p.id === o.packId);
      pay.packId = pack.id; pay.credits = pack.credits;
      wallet.credit(o.uid, pack.credits); message = `+${pack.credits.toLocaleString()} credits`;
    } else {
      pay.tournamentId = o.tournamentId;
      const ok = tours.joinPaid(o.tournamentId, o.uid, cap.captureId, cap.amountCents);
      if (!ok) {
        pay.refunded = true;
        paypal.refund(cap.captureId).catch((e) => console.error('[refund failed]', cap.captureId, e.message));
        message = 'The tournament filled up or closed, so your payment was refunded.';
      } else message = 'You’re entered. Good luck.';
    }
    D.payments[id] = pay; store.save();
    res.json({ ok: true, message, user: me(req.user), tournamentId: o.tournamentId });
  } catch (e) { res.status(400).json({ error: e.message }); }
  finally { capturing.delete(id); }
});

// ---- admin ----
app.get('/api/admin/users', auth, admin, wrap((req) => {
  const q = normEmail(req.query.q);
  return Object.values(D.users).filter((u) => !q || u.email.includes(q) || u.name.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
    .map((u) => ({ id: u.id, email: u.email, name: u.name, credits: u.credits, banned: !!u.banned, createdAt: u.createdAt, stats: u.stats || null }));
}));
app.post('/api/admin/users/:id/credits', auth, admin, wrap((req) => {
  const u = D.users[req.params.id]; const amt = Number(req.body.amount);
  if (!u || !Number.isInteger(amt) || amt === 0) throw new Error('Pick a user and a non-zero whole amount');
  const ok = amt > 0 ? wallet.credit(u.id, amt) : wallet.debit(u.id, -amt);
  if (!ok) throw new Error('Could not adjust (not enough credits to remove?)');
  return { credits: u.credits };
}));
app.post('/api/admin/users/:id/ban', auth, admin, wrap((req) => {
  const u = D.users[req.params.id];
  if (!u || isAdmin(u)) throw new Error('Cannot change this account');
  u.banned = !!req.body.banned; store.save();
  if (u.banned) { tables.leaveAll(u.id); io.to('user:' + u.id).disconnectSockets(true); }
  return { banned: u.banned };
}));
app.get('/api/admin/payments', auth, admin, wrap(() => Object.entries(D.payments).map(([id, p]) => ({ id, ...p, email: D.users[p.uid]?.email, tournament: p.tournamentId ? D.tournaments[p.tournamentId]?.name : undefined })).sort((a, b) => b.at - a.at).slice(0, 200)));
app.post('/api/admin/tournaments/:id/prize', auth, admin, wrap((req) => tours.publicView(tours.markPrize(req.params.id, req.body.place, req.body.status, req.body.note), req.user.id, true)));
app.post('/api/admin/tournaments', auth, admin, wrap((req) => tours.publicView(tours.create(req.body), req.user.id, true)));
app.post('/api/admin/tournaments/:id/finish', auth, admin, wrap((req) => tours.publicView(tours.finish(req.params.id), req.user.id, true)));
app.post('/api/admin/tournaments/:id/cancel', auth, admin, wrap((req) => {
  const refunds = tours.cancel(req.params.id);
  for (const r of refunds) {
    if (!paypal) { console.error('[refund needed, PayPal not configured]', r.paymentIntent); continue; }
    paypal.refund(r.paymentIntent)
      .then(() => { for (const p of Object.values(D.payments)) if (p.captureId === r.paymentIntent) p.refunded = true; store.save(); })
      .catch((e) => console.error('[refund failed]', r.paymentIntent, e.message));
  }
  return { ok: true, refunds: refunds.length };
}));

// ---- realtime ----
const socketsPerUser = new Map();
io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth?.token);
  if (!u) return next(new Error('unauthorized'));
  socket.data.uid = u.id; next();
});
io.on('connection', (socket) => {
  const uid = socket.data.uid;
  const u = () => D.users[uid];
  socketsPerUser.set(uid, (socketsPerUser.get(uid) || 0) + 1);
  socket.join('user:' + uid); socket.join('lobby');
  socket.emit('tables', tables.list());
  let last = 0;
  const on = (ev, fn) => socket.on(ev, (data = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    const now = Date.now(); if (now - last < 80) return ack({ error: 'Slow down' }); last = now;
    if (!u() || u().banned) return ack({ error: 'Account unavailable' });
    try { ack({ ok: true, data: fn(data || {}) }); } catch (e) { ack({ error: e.message }); }
  });
  on('table:watch', ({ tableId }) => {
    for (const r of socket.rooms) if (r.startsWith('table:')) socket.leave(r);
    const t = tables.get(tableId); socket.join('table:' + t.id); return t.view();
  });
  on('table:sit', ({ tableId, seat }) => tables.get(tableId).sit(uid, u().name, seat));
  on('table:leave', ({ tableId }) => tables.get(tableId).leave(uid));
  on('table:bet', ({ tableId, amount }) => tables.get(tableId).bet(uid, amount));
  on('table:clear', ({ tableId }) => tables.get(tableId).clearBet(uid));
  on('table:act', ({ tableId, action }) => tables.get(tableId).act(uid, action));
  on('tour:deal', ({ id, bet }) => { const r = tours.deal(id, uid, bet); return { round: r, t: tours.publicView(tours.get(id), uid) }; });
  on('tour:act', ({ id, action }) => { const r = tours.act(id, uid, action); return { round: r, t: tours.publicView(tours.get(id), uid) }; });
  socket.on('disconnect', () => {
    const n = (socketsPerUser.get(uid) || 1) - 1;
    if (n <= 0) { socketsPerUser.delete(uid); tables.leaveAll(uid); } else socketsPerUser.set(uid, n);
  });
});

const shutdown = async () => {
  store.flush();
  if (store.remote) { await store.remote.flush(); await store.remote.close().catch(() => {}); }
  process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

if (require.main === module) server.listen(PORT, () => console.log(`Blackjack running on ${PUBLIC_URL}`));
module.exports = { server, store, tables, tours };
