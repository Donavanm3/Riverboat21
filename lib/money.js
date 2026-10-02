'use strict';
// "Earn real money" program — legal ways for players to earn that never depend on a casino-game result:
//   - referral / creator commissions on real purchases made by people they brought in
//   - prizes for free-entry contests (fan art, clips, guides), bug bounties, and paid community jobs
//   - cash prizes from free-entry tournaments
// Credits can NEVER be converted to money; money only comes from the sources above.
// Every amount here is in US cents. Payouts are sent by the admin (e.g. PayPal) and marked paid.
const crypto = require('crypto');
const DAY = 24 * 3600 * 1000;
const DEFAULTS = { referralPercent: 20, windowDays: 365, holdDays: 30, minPayoutCents: 1000 };
const CODE_RE = /^[A-Z0-9]{4,16}$/;
const KINDS = ['contest', 'bounty', 'job'];

class Money {
  constructor(store) {
    this.store = store;
    const D = store.data;
    D.codes = D.codes || {};          // CODE -> { uid, percent (null = default), creator: bool }
    D.earnings = D.earnings || [];     // ledger entries
    D.payouts = D.payouts || [];       // payout requests
    D.opps = D.opps || [];             // contests / bounties / jobs
    D.submissions = D.submissions || [];
    D.moneySettings = { ...DEFAULTS, ...(D.moneySettings || {}) };
  }
  get D() { return this.store.data; }
  get cfg() { return this.D.moneySettings; }
  save() { this.store.save(); }
  user(uid) { return this.D.users[uid]; }
  id() { return crypto.randomBytes(8).toString('hex'); }

  // ---------- settings ----------
  updateSettings(b) {
    const n = (v, lo, hi, label) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${label} must be ${lo}–${hi}`); return x; };
    const s = this.cfg;
    if (b.referralPercent !== undefined) s.referralPercent = Math.round(n(b.referralPercent, 0, 50, 'Referral %') * 10) / 10;
    if (b.windowDays !== undefined) s.windowDays = Math.round(n(b.windowDays, 1, 3650, 'Commission window (days)'));
    if (b.holdDays !== undefined) s.holdDays = Math.round(n(b.holdDays, 0, 180, 'Hold period (days)'));
    if (b.minPayoutCents !== undefined) s.minPayoutCents = Math.round(n(b.minPayoutCents, 100, 100000, 'Minimum payout (cents)'));
    this.save(); return s;
  }

  // ---------- joining & codes ----------
  codeOf(uid) { return Object.keys(this.D.codes).find((c) => this.D.codes[c].uid === uid && !this.D.codes[c].creator) || null; }
  join(uid, { adult, accept } = {}) {
    if (adult !== true || accept !== true) throw new Error('Confirm you are 18+ and accept the program terms');
    const u = this.user(uid);
    if (!u.money) u.money = { joinedAt: Date.now(), w9: false };
    if (!this.codeOf(uid)) {
      let code;
      do { code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6); } while (this.D.codes[code]);
      this.D.codes[code] = { uid, percent: null, creator: false, createdAt: Date.now() };
    }
    this.save();
  }
  setCreatorCode(email, code, percent) {
    const uid = this.D.emailIndex[String(email || '').trim().toLowerCase()];
    if (!uid) throw new Error('No player with that email');
    code = String(code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new Error('Code: 4–16 letters or numbers');
    const p = Number(percent);
    if (!Number.isFinite(p) || p < 0 || p > 50) throw new Error('Commission must be 0–50%');
    const existing = this.D.codes[code];
    if (existing && existing.uid !== uid) throw new Error('That code belongs to someone else');
    this.D.codes[code] = { uid, percent: p, creator: true, createdAt: existing?.createdAt || Date.now() };
    const u = this.user(uid); if (!u.money) u.money = { joinedAt: Date.now(), w9: false };
    this.save();
  }
  removeCode(code) { delete this.D.codes[String(code).toUpperCase()]; this.save(); }
  // Called at sign-up. Only a valid code of an existing, non-banned member sticks.
  attachReferral(newUid, rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    const c = this.D.codes[code];
    if (!code || !c || c.uid === newUid) return false;
    const owner = this.user(c.uid);
    if (!owner || owner.banned) return false;
    const u = this.user(newUid);
    u.referredBy = { uid: c.uid, code, at: Date.now() };
    this.save(); return true;
  }

  // ---------- ledger ----------
  add(uid, kind, cents, { sourceId = null, note = '', hold = true } = {}) {
    if (!Number.isInteger(cents) || cents <= 0) return null;
    const now = Date.now();
    const e = { id: this.id(), uid, kind, cents, sourceId, note: String(note).slice(0, 200), at: now,
      availableAt: hold ? now + this.cfg.holdDays * DAY : now, status: 'pending' };
    this.D.earnings.push(e); this.save(); return e;
  }
  refresh(e) { if (e.status === 'pending' && Date.now() >= e.availableAt) e.status = 'available'; return e; }
  // A purchase that was actually captured. Pays the referrer if inside the window.
  onPurchase(buyerUid, orderId, amountCents, captureId) {
    const buyer = this.user(buyerUid);
    const ref = buyer && buyer.referredBy;
    if (!ref || !Number.isInteger(amountCents) || amountCents <= 0) return null;
    if (Date.now() - (buyer.createdAt || 0) > this.cfg.windowDays * DAY) return null;
    const c = this.D.codes[ref.code];
    const percent = c && c.uid === ref.uid && c.percent !== null ? c.percent : this.cfg.referralPercent;
    const owner = this.user(ref.uid);
    if (!owner || owner.banned || !percent) return null;
    const cents = Math.floor((amountCents * percent) / 100);
    return this.add(ref.uid, 'referral', cents, { sourceId: captureId || orderId, note: `${percent}% of a ${(amountCents / 100).toFixed(2)} purchase` });
  }
  voidSource(sourceId, why = 'Purchase refunded') {
    let n = 0;
    for (const e of this.D.earnings) if (e.sourceId === sourceId && ['pending', 'available'].includes(this.refresh(e).status)) { e.status = 'voided'; e.note += ` · ${why}`; n++; }
    if (n) this.save(); return n;
  }
  voidEntry(id, why) {
    const e = this.D.earnings.find((x) => x.id === id);
    if (!e) throw new Error('Not found');
    if (!['pending', 'available'].includes(this.refresh(e).status)) throw new Error('Only pending or available earnings can be voided');
    e.status = 'voided'; e.note += ` · ${String(why || 'voided by admin').slice(0, 100)}`; this.save();
  }
  balances(uid) {
    const b = { pendingCents: 0, availableCents: 0, requestedCents: 0, paidCents: 0 };
    for (const e of this.D.earnings) if (e.uid === uid) { const s = this.refresh(e).status; if (b[s + 'Cents'] !== undefined) b[s + 'Cents'] += e.cents; }
    return b;
  }

  // ---------- payouts ----------
  requestPayout(uid, paypalEmail) {
    const u = this.user(uid);
    if (!u.money) throw new Error('Join the program first');
    const email = String(paypalEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter the PayPal email to pay');
    if (this.D.payouts.some((p) => p.uid === uid && p.status === 'requested')) throw new Error('You already have a payout waiting');
    const items = this.D.earnings.filter((e) => e.uid === uid && this.refresh(e).status === 'available');
    const cents = items.reduce((s, e) => s + e.cents, 0);
    if (cents < this.cfg.minPayoutCents) throw new Error(`Minimum payout is $${(this.cfg.minPayoutCents / 100).toFixed(2)}`);
    const p = { id: this.id(), uid, cents, paypalEmail: email, earningIds: items.map((e) => e.id), status: 'requested', at: Date.now() };
    items.forEach((e) => { e.status = 'requested'; });
    u.money.paypalEmail = email;
    this.D.payouts.push(p); this.save(); return p;
  }
  settlePayout(id, paid, note) {
    const p = this.D.payouts.find((x) => x.id === id);
    if (!p || p.status !== 'requested') throw new Error('No open payout with that id');
    if (paid && !this.user(p.uid)?.money?.w9) throw new Error('Get this player’s W-9 (tax form) before paying, then mark it received');
    p.status = paid ? 'paid' : 'rejected'; p.note = String(note || '').slice(0, 200); p.settledAt = Date.now();
    for (const e of this.D.earnings) if (p.earningIds.includes(e.id)) e.status = paid ? 'paid' : 'available';
    this.save(); return p;
  }
  setW9(uid, onFile) { const u = this.user(uid); if (!u) throw new Error('No such player'); u.money = u.money || { joinedAt: Date.now() }; u.money.w9 = !!onFile; this.save(); }
  paidThisYear(uid) {
    const y = new Date().getFullYear();
    return this.D.payouts.filter((p) => p.uid === uid && p.status === 'paid' && new Date(p.settledAt).getFullYear() === y).reduce((s, p) => s + p.cents, 0);
  }

  // ---------- contests, bounties, jobs ----------
  createOpp(b) {
    const kind = KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) throw new Error('Pick contest, bounty, or job');
    const title = String(b.title || '').trim().slice(0, 80);
    if (title.length < 3) throw new Error('Give it a title');
    const description = String(b.description || '').trim().slice(0, 2000);
    if (description.length < 10) throw new Error('Describe what people should do');
    const reward = String(b.reward || '').trim().slice(0, 120);
    if (!reward) throw new Error('Say what it pays (e.g. “$50 to the winner”)');
    const rules = String(b.rules || '').trim().slice(0, 4000);
    if (kind === 'contest' && rules.length < 40) throw new Error('Contests need official rules (free entry, 18+, how winners are judged, deadline)');
    const endsAt = b.endsAt ? Date.parse(b.endsAt) : null;
    if (b.endsAt && (!Number.isFinite(endsAt) || endsAt < Date.now())) throw new Error('End date must be in the future');
    const o = { id: this.id(), kind, title, description, reward, rules, endsAt, status: 'open', createdAt: Date.now() };
    this.D.opps.unshift(o); this.save(); return o;
  }
  closeOpp(id) { const o = this.D.opps.find((x) => x.id === id); if (!o) throw new Error('Not found'); o.status = 'closed'; this.save(); }
  isOpen(o) { return o.status === 'open' && (!o.endsAt || Date.now() < o.endsAt); }
  submit(uid, oppId, { link, message, adult } = {}) {
    const o = this.D.opps.find((x) => x.id === oppId);
    if (!o || !this.isOpen(o)) throw new Error('This one is closed');
    if (adult !== true) throw new Error('Confirm you are 18 or older');
    const url = String(link || '').trim();
    if (url && !/^https:\/\/\S+$/i.test(url)) throw new Error('Links must start with https://');
    const msg = String(message || '').trim().slice(0, 2000);
    if (!url && msg.length < 10) throw new Error('Add a link or a few sentences');
    if (this.D.submissions.filter((s) => s.uid === uid && s.oppId === oppId).length >= 3) throw new Error('Up to 3 entries each');
    const s = { id: this.id(), uid, oppId, link: url, message: msg, status: 'submitted', at: Date.now() };
    this.D.submissions.unshift(s); this.save(); return s;
  }
  award(subId, cents, note) {
    const s = this.D.submissions.find((x) => x.id === subId);
    if (!s) throw new Error('Not found');
    if (s.status === 'awarded') throw new Error('Already awarded');
    if (!Number.isInteger(cents) || cents < 100 || cents > 1000000) throw new Error('Award $1 to $10,000');
    const o = this.D.opps.find((x) => x.id === s.oppId);
    const u = this.user(s.uid); u.money = u.money || { joinedAt: Date.now(), w9: false };
    this.add(s.uid, o ? o.kind : 'award', cents, { sourceId: s.id, note: note || (o ? o.title : 'Award'), hold: false });
    s.status = 'awarded'; s.awardCents = cents; this.save(); return s;
  }
  rejectSubmission(subId) { const s = this.D.submissions.find((x) => x.id === subId); if (!s) throw new Error('Not found'); s.status = 'declined'; this.save(); }
  // Cash prizes from free-entry tournaments.
  tournamentPrize(uid, cents, tournamentName, tournamentId) {
    const u = this.user(uid); if (!u) return null;
    u.money = u.money || { joinedAt: Date.now(), w9: false };
    return this.add(uid, 'tournament', cents, { sourceId: tournamentId + ':' + uid, note: `Prize: ${tournamentName}`, hold: false });
  }

  // ---------- views ----------
  playerView(uid, publicUrl) {
    const u = this.user(uid);
    const code = this.codeOf(uid);
    const creatorCodes = Object.entries(this.D.codes).filter(([, c]) => c.uid === uid && c.creator).map(([k, c]) => ({ code: k, percent: c.percent }));
    const referred = Object.values(this.D.users).filter((x) => x.referredBy && x.referredBy.uid === uid);
    return {
      joined: !!u.money, code, creatorCodes, link: code ? `${publicUrl}/?ref=${code}` : null,
      percent: this.cfg.referralPercent, windowDays: this.cfg.windowDays, holdDays: this.cfg.holdDays, minPayoutCents: this.cfg.minPayoutCents,
      referrals: referred.length, balances: this.balances(uid), w9: !!u.money?.w9, paypalEmail: u.money?.paypalEmail || '',
      ledger: this.D.earnings.filter((e) => e.uid === uid).slice(-50).reverse().map((e) => ({ kind: e.kind, cents: e.cents, status: this.refresh(e).status, note: e.note, at: e.at, availableAt: e.availableAt })),
      payouts: this.D.payouts.filter((p) => p.uid === uid).slice(-20).reverse().map(({ cents, status, at, settledAt, note }) => ({ cents, status, at, settledAt, note })),
    };
  }
  oppsView(uid) {
    return {
      open: this.D.opps.filter((o) => this.isOpen(o)).map(({ id, kind, title, description, reward, rules, endsAt }) => ({ id, kind, title, description, reward, rules, endsAt })),
      mine: this.D.submissions.filter((s) => s.uid === uid).slice(0, 30).map((s) => ({ ...s, title: this.D.opps.find((o) => o.id === s.oppId)?.title || '' })),
    };
  }
  adminView() {
    const name = (uid) => { const u = this.user(uid); return u ? { name: u.name, email: u.email, w9: !!u.money?.w9, paidThisYearCents: this.paidThisYear(uid) } : {}; };
    return {
      settings: this.cfg,
      payouts: this.D.payouts.filter((p) => p.status === 'requested').map((p) => ({ ...p, ...name(p.uid) })),
      recentPayouts: this.D.payouts.filter((p) => p.status !== 'requested').slice(-30).reverse().map((p) => ({ ...p, ...name(p.uid) })),
      codes: Object.entries(this.D.codes).filter(([, c]) => c.creator).map(([code, c]) => ({ code, percent: c.percent, ...name(c.uid) })),
      opps: this.D.opps.slice(0, 50).map((o) => ({ ...o, open: this.isOpen(o), entries: this.D.submissions.filter((s) => s.oppId === o.id).length })),
      submissions: this.D.submissions.filter((s) => s.status === 'submitted').slice(0, 100).map((s) => ({ ...s, ...name(s.uid), title: this.D.opps.find((o) => o.id === s.oppId)?.title || '' })),
      recentEarnings: this.D.earnings.slice(-40).reverse().map((e) => ({ ...this.refresh(e), ...name(e.uid) })),
      totals: this.D.earnings.reduce((t, e) => { t[this.refresh(e).status] = (t[e.status] || 0) + e.cents; return t; }, {}),
    };
  }
}
module.exports = { Money, DEFAULTS };
