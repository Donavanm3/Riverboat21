'use strict';
const { Shoe, Round } = require('./blackjack');

const SEATS = 5;
const BET_WINDOW_MS = Number(process.env.BET_WINDOW_MS || 10000);
const TURN_MS = Number(process.env.TURN_MS || 20000);
const RESULT_MS = Number(process.env.RESULT_MS || 5000);

class Table {
  constructor(cfg, deps) {
    Object.assign(this, { id: cfg.id, name: cfg.name, min: cfg.min, max: cfg.max });
    this.wallet = deps.wallet; this.emit = () => deps.onChange(this);
    this.seats = Array(SEATS).fill(null);
    this.phase = 'betting'; this.round = null;
    this.countdownEnd = null; this.turnEnd = null; this.timer = null;
    this.shoe = new Shoe(6);
  }
  seatOf(uid) { return this.seats.findIndex((s) => s && s.uid === uid); }
  sit(uid, name, i) {
    const mine = this.seatOf(uid);
    if (mine !== -1 && this.seats[mine].leaving) { this.seats[mine].leaving = false; this.emit(); return; } // came back mid-hand
    if (mine !== -1) throw new Error('You already have a seat here');
    if (!Number.isInteger(i) || i < 0 || i >= SEATS) throw new Error('Pick a seat');
    if (this.seats[i]) throw new Error('That seat is taken');
    this.seats[i] = { uid, name, bet: 0, leaving: false };
    this.emit();
  }
  leave(uid) {
    const i = this.seatOf(uid);
    if (i === -1) return;
    const s = this.seats[i];
    if (s.bet > 0) { this.wallet.unhold(uid, s.bet); s.bet = 0; }
    if (this.round && this.round.phase === 'playing' && this.round.owners().includes(uid)) {
      s.leaving = true;
      const cur = this.round.current();
      if (cur && cur.owner === uid) this.after();
    } else this.seats[i] = null;
    if (!this.seats.some((x) => x && x.bet > 0)) this.stopCountdown();
    this.emit();
  }
  bet(uid, amount) {
    if (this.phase !== 'betting') throw new Error('Wait for the next hand');
    const s = this.seats[this.seatOf(uid)];
    if (!s) throw new Error('Take a seat first');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid bet');
    if (s.bet + amount > this.max) throw new Error(`Table max is ${this.max}`);
    if (!this.wallet.hold(uid, amount)) throw new Error('Not enough credits');
    s.bet += amount;
    if (!this.countdownEnd) {
      this.countdownEnd = Date.now() + BET_WINDOW_MS;
      this.timer = setTimeout(() => this.start(), BET_WINDOW_MS);
    }
    this.emit();
  }
  clearBet(uid) {
    if (this.phase !== 'betting') return;
    const s = this.seats[this.seatOf(uid)];
    if (!s || !s.bet) return;
    this.wallet.unhold(uid, s.bet); s.bet = 0;
    if (!this.seats.some((x) => x && x.bet > 0)) this.stopCountdown();
    this.emit();
  }
  stopCountdown() { clearTimeout(this.timer); this.timer = null; this.countdownEnd = null; }
  start() {
    this.stopCountdown();
    const parts = [];
    this.seats.forEach((s, i) => {
      if (!s || !s.bet) return;
      if (s.bet < this.min) { this.wallet.unhold(s.uid, s.bet); s.bet = 0; return; }
      parts.push({ owner: s.uid, seat: i, bet: s.bet }); s.bet = 0;
    });
    if (!parts.length) { this.phase = 'betting'; this.emit(); return; }
    this.round = new Round(this.shoe, parts);
    this.round.deal();
    this.phase = 'playing';
    this.after();
  }
  act(uid, action) {
    if (this.phase !== 'playing' || !this.round) throw new Error('No hand in progress');
    const cur = this.round.current();
    if (!cur || cur.owner !== uid) throw new Error('Not your turn');
    const cost = this.round.extraCost(action);
    if (cost && !this.wallet.hold(uid, cost)) throw new Error('Not enough credits to ' + action);
    try { this.round.act(uid, action); }
    catch (e) { if (cost) this.wallet.unhold(uid, cost); throw e; }
    this.after();
  }
  after() {
    clearTimeout(this.timer); this.turnEnd = null;
    // Auto-stand anyone who left the table.
    let cur = this.round.current();
    while (cur) {
      const s = this.seats[cur.seat];
      if (s && s.uid === cur.owner && !s.leaving) break;
      this.round.forceStand(); cur = this.round.current();
    }
    if (this.round.phase === 'done') return this.settle();
    this.turnEnd = Date.now() + TURN_MS;
    this.timer = setTimeout(() => { this.round.forceStand(); this.after(); }, TURN_MS);
    this.emit();
  }
  settle() {
    for (const uid of this.round.owners()) this.wallet.settle(uid, this.round.stakeFor(uid), this.round.payoutFor(uid));
    this.phase = 'result';
    this.seats = this.seats.map((s) => (s && s.leaving ? null : s));
    this.emit();
    this.timer = setTimeout(() => { this.phase = 'betting'; this.round = null; this.emit(); }, RESULT_MS);
  }
  view() {
    return {
      id: this.id, name: this.name, min: this.min, max: this.max, phase: this.phase,
      seats: this.seats.map((s) => (s ? { uid: s.uid, name: s.name, bet: s.bet } : null)),
      round: this.round ? this.round.view() : null,
      countdownEnd: this.countdownEnd, turnEnd: this.turnEnd, now: Date.now(),
    };
  }
  summary() { return { id: this.id, name: this.name, min: this.min, max: this.max, players: this.seats.filter(Boolean).length, seats: SEATS }; }
}

class TableManager {
  constructor(configs, deps) { this.tables = new Map(configs.map((c) => [c.id, new Table(c, deps)])); }
  get(id) { const t = this.tables.get(id); if (!t) throw new Error('Table not found'); return t; }
  list() { return [...this.tables.values()].map((t) => t.summary()); }
  leaveAll(uid) { for (const t of this.tables.values()) t.leave(uid); }
}
module.exports = { TableManager, Table };
