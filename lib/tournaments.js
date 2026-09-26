'use strict';
const crypto = require('crypto');
const { Shoe, Round } = require('./blackjack');

// Format: every entrant gets the same starting stack and a fixed number of hands vs the dealer.
// Highest stack at the end time wins. Tournament chips are separate from wallet credits.
//
// Entry types:  free | credits (pay play credits) | paid (real money via PayPal)
// Prize types:  credits (play credits, 50/30/20 of the pool)
//               cash | item (real prizes the organizer pays out off-platform, per place)
//
// HARD RULE enforced here: a real prize (cash | item) always means FREE entry.
// Paid entry + real prize = consideration + chance + prize = unlicensed gambling.
const SPLITS = [0.5, 0.3, 0.2];
const REAL = new Set(['cash', 'item']);

class Tournaments {
  constructor(store, wallet, onChange = () => {}) {
    this.store = store; this.wallet = wallet; this.onChange = onChange;
    this.rounds = new Map(); this.shoes = new Map();
    for (const t of Object.values(this.all())) for (const e of Object.values(t.entries)) {
      if (e.inHand) { e.stack += e.inHand; e.inHand = 0; }
    }
    store.save();
  }
  all() { return this.store.data.tournaments; }
  get(id) { const t = this.all()[id]; if (!t) throw new Error('Tournament not found'); return t; }
  isReal(t) { return REAL.has(t.prizeType); }

  create(input) {
    const int = (v, lo, hi, label) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label} must be a whole number from ${lo} to ${hi}`);
      return n;
    };
    const text = (v, max) => String(v || '').trim().slice(0, max);
    const name = text(input.name, 60);
    if (name.length < 3) throw new Error('Give the tournament a name');
    const prizeType = ['credits', 'cash', 'item'].includes(input.prizeType) ? input.prizeType : 'credits';
    let entryType = ['free', 'credits', 'paid'].includes(input.entryType) ? input.entryType : 'free';
    if (REAL.has(prizeType) && entryType !== 'free') {
      throw new Error('Real-money and item prizes must be free to enter. Paid entry is only available for credit prizes.');
    }
    const endsAt = Date.parse(input.endsAt);
    if (!Number.isFinite(endsAt) || endsAt < Date.now() + 60000) throw new Error('End time must be at least a minute from now');
    const startingStack = int(input.startingStack ?? 1000, 100, 1e6, 'Starting stack');
    const minBet = int(input.minBet ?? 10, 1, startingStack, 'Min bet');
    const t = {
      id: crypto.randomUUID(), name, prizeType, entryType,
      entryFee: entryType === 'credits' ? int(input.entryFee, 1, 1e7, 'Credit entry fee') : 0,
      entryPriceCents: entryType === 'paid' ? int(Math.round(Number(input.entryPrice) * 100), 50, 100000, 'Entry price (cents)') : 0,
      prizeCredits: prizeType === 'credits' ? int(input.prizeCredits ?? 0, 0, 1e8, 'House prize') : 0,
      prizes: [], rules: text(input.rules, 4000),
      startingStack, minBet,
      maxBet: int(input.maxBet ?? startingStack, minBet, startingStack, 'Max bet'),
      hands: int(input.hands ?? 30, 5, 500, 'Hands'),
      maxEntrants: int(input.maxEntrants ?? 500, 2, 10000, 'Max entrants'),
      createdAt: Date.now(), endsAt, status: 'open', entries: {}, winners: [],
    };
    if (REAL.has(prizeType)) {
      const list = Array.isArray(input.prizes) ? input.prizes : [];
      t.prizes = list.slice(0, 3).map((p, i) => ({
        place: i + 1,
        description: text(p && p.description, 200),
        valueCents: Math.max(0, Math.round(Number(p && p.value || 0) * 100)) || 0,
      })).filter((p) => p.description);
      if (!t.prizes.length) throw new Error('Describe at least the 1st place prize');
      if (t.rules.length < 40) throw new Error('Real prizes need official rules (eligibility, how winners are picked, how prizes are delivered)');
    }
    this.all()[t.id] = t; this.store.save(); this.onChange(t);
    return t;
  }
  pool(t) { return t.prizeCredits + t.entryFee * Object.keys(t.entries).length; }
  canJoin(t, uid) {
    if (t.status !== 'open' || Date.now() > t.endsAt) throw new Error('This tournament is closed');
    if (t.entries[uid]) throw new Error('You are already entered');
    if (Object.keys(t.entries).length >= t.maxEntrants) throw new Error('Tournament is full');
  }
  addEntry(t, uid, extra = {}) {
    t.entries[uid] = { stack: t.startingStack, handsPlayed: 0, inHand: 0, finished: false, joinedAt: Date.now(), ...extra };
    this.store.save(); this.onChange(t);
  }
  join(id, uid, { confirmEligible } = {}) {
    const t = this.get(id);
    this.canJoin(t, uid);
    if (t.entryType === 'paid') throw new Error('This tournament has a paid entry. Use checkout.');
    if (this.isReal(t) && !confirmEligible) throw new Error('Confirm you are eligible and accept the official rules');
    if (t.entryType === 'credits' && !this.wallet.debit(uid, t.entryFee)) throw new Error('Not enough credits for the entry fee');
    this.addEntry(t, uid, this.isReal(t) ? { acceptedRulesAt: Date.now() } : {});
  }
  // Called only after the server has captured a verified PayPal payment. Returns false when the entry must be refunded.
  joinPaid(id, uid, paymentIntent, amount) {
    const t = this.all()[id];
    if (!t || t.entryType !== 'paid') return false;
    try { this.canJoin(t, uid); } catch { return false; }
    this.addEntry(t, uid, { paymentIntent, paidCents: amount });
    return true;
  }
  entry(t, uid) {
    const e = t.entries[uid];
    if (!e) throw new Error('Join the tournament first');
    if (t.status !== 'open' || Date.now() > t.endsAt) throw new Error('This tournament has ended');
    return e;
  }
  deal(id, uid, bet) {
    const t = this.get(id), e = this.entry(t, uid), key = id + ':' + uid;
    const r = this.rounds.get(key);
    if (r && r.phase === 'playing') throw new Error('Finish the current hand first');
    if (e.finished) throw new Error('You have played all your hands');
    if (!Number.isInteger(bet) || bet < t.minBet || bet > t.maxBet) throw new Error(`Bet between ${t.minBet} and ${t.maxBet}`);
    if (bet > e.stack) throw new Error('Not enough tournament chips');
    if (!this.shoes.has(id)) this.shoes.set(id, new Shoe(6));
    e.stack -= bet; e.inHand = bet;
    const round = new Round(this.shoes.get(id), [{ owner: uid, seat: 0, bet }]);
    this.rounds.set(key, round);
    round.deal();
    return this.after(t, e, round);
  }
  act(id, uid, action) {
    const t = this.get(id), e = this.entry(t, uid);
    const round = this.rounds.get(id + ':' + uid);
    if (!round || round.phase !== 'playing') throw new Error('No hand in progress');
    const cost = round.extraCost(action);
    if (cost > e.stack) throw new Error('Not enough tournament chips to ' + action);
    round.act(uid, action);
    e.stack -= cost; e.inHand += cost;
    return this.after(t, e, round);
  }
  after(t, e, round) {
    if (round.phase === 'done') {
      e.stack += round.payoutFor(round.owners()[0]); e.inHand = 0; e.handsPlayed++;
      if (e.handsPlayed >= t.hands || e.stack < t.minBet) e.finished = true;
      this.onChange(t);
    }
    this.store.save();
    return round.view();
  }
  standings(t) {
    return Object.entries(t.entries)
      .map(([uid, e]) => ({ uid, name: this.wallet.user(uid)?.name || 'Player', stack: e.stack + e.inHand, handsPlayed: e.handsPlayed, finished: e.finished }))
      .sort((a, b) => b.stack - a.stack || a.handsPlayed - b.handsPlayed);
  }
  finish(id) {
    const t = this.get(id);
    if (t.status !== 'open') throw new Error('Already closed');
    for (const [uid, e] of Object.entries(t.entries)) {
      const r = this.rounds.get(id + ':' + uid);
      if (r && r.phase === 'playing') { e.stack += e.inHand; e.inHand = 0; }
      this.rounds.delete(id + ':' + uid);
    }
    const top = this.standings(t).slice(0, 3);
    if (this.isReal(t)) {
      t.winners = top.slice(0, t.prizes.length).map((w, i) => ({
        uid: w.uid, name: w.name, place: i + 1, stack: w.stack, prize: t.prizes[i].description, valueCents: t.prizes[i].valueCents, prizeStatus: 'pending',
      }));
    } else {
      const pool = this.pool(t);
      const shareSum = SPLITS.slice(0, top.length).reduce((a, b) => a + b, 0) || 1;
      t.winners = top.map((w, i) => {
        const prize = Math.floor((pool * SPLITS[i]) / shareSum);
        if (prize > 0) this.wallet.credit(w.uid, prize);
        return { uid: w.uid, name: w.name, place: i + 1, stack: w.stack, prizeCredits: prize };
      });
    }
    t.status = 'finished'; t.finishedAt = Date.now();
    this.store.save(); this.onChange(t);
    return t;
  }
  markPrize(id, place, status, note) {
    const t = this.get(id);
    const w = t.winners.find((x) => x.place === Number(place));
    if (!w || !this.isReal(t)) throw new Error('No real prize for that place');
    if (!['pending', 'contacted', 'sent'].includes(status)) throw new Error('Unknown status');
    w.prizeStatus = status; w.prizeNote = String(note || '').slice(0, 300); w.prizeUpdatedAt = Date.now();
    this.store.save(); return t;
  }
  // Returns PayPal capture ids (as paymentIntent) that the caller must refund.
  cancel(id) {
    const t = this.get(id);
    if (t.status !== 'open') throw new Error('Already closed');
    const refunds = [];
    for (const [uid, e] of Object.entries(t.entries)) {
      if (t.entryType === 'credits') this.wallet.credit(uid, t.entryFee);
      if (e.paymentIntent) refunds.push({ uid, paymentIntent: e.paymentIntent });
      this.rounds.delete(id + ':' + uid);
    }
    t.status = 'cancelled'; this.store.save(); this.onChange(t);
    return refunds;
  }
  tick() { for (const t of Object.values(this.all())) if (t.status === 'open' && Date.now() > t.endsAt) this.finish(t.id); }
  publicView(t, uid, admin = false) {
    const e = t.entries[uid];
    const round = this.rounds.get(t.id + ':' + uid);
    const v = {
      id: t.id, name: t.name, prizeType: t.prizeType, entryType: t.entryType, entryFee: t.entryFee, entryPriceCents: t.entryPriceCents,
      prizePool: this.pool(t), prizes: t.prizes, rules: t.rules,
      startingStack: t.startingStack, minBet: t.minBet, maxBet: t.maxBet,
      hands: t.hands, endsAt: t.endsAt, status: t.status, entrants: Object.keys(t.entries).length, maxEntrants: t.maxEntrants,
      standings: this.standings(t).slice(0, 25),
      winners: t.winners.map(({ prizeNote, ...w }) => w),
      me: e ? { stack: e.stack, handsPlayed: e.handsPlayed, finished: e.finished } : null,
      round: round ? round.view() : null,
    };
    if (admin) {
      v.winners = t.winners.map((w) => ({ ...w, email: this.wallet.user(w.uid)?.email }));
      v.revenueCents = Object.values(t.entries).reduce((s, x) => s + (x.paidCents || 0), 0);
    }
    return v;
  }
}
module.exports = { Tournaments };
