'use strict';
// Casino game handlers shared by the online server (server.js) and the offline app (docs/offline.js).
const casino = require('./casino');

function createGames(wallet) {
  const shoe = new casino.BaccaratShoe();
  const pokerHands = new Map(); // uid -> { bet, hand, deck }; the bet sits in escrow until the draw
  const minesRounds = new Map(); // uid -> mines state; bet in escrow until cash out or bomb
  const crashRounds = new Map(); // uid -> crash state; bet in escrow until cash out or crash
  const lastPlay = new Map();
  const credits = (uid) => wallet.user(uid).credits;
  function guard(uid) {
    const now = Date.now();
    if (now - (lastPlay.get(uid) || 0) < 300) throw new Error('Slow down a little');
    lastPlay.set(uid, now);
  }
  function oneShot(uid, stake, run) {
    if (!wallet.hold(uid, stake)) throw new Error('Not enough credits');
    let out;
    try { out = run(); } catch (e) { wallet.unhold(uid, stake); throw e; }
    wallet.settle(uid, stake, out.payout);
    return { ...out, stake, credits: credits(uid) };
  }
  return {
    info: () => ({
      slots: { symbols: casino.SYMBOLS.map(({ id, three }) => ({ id, three })), cherryTwo: casino.CHERRY_TWO, lines: casino.LINES, rtp: casino.slotsRTP() },
      poker: { paytable: casino.PAYTABLE },
      roulette: { red: [...casino.RED] },
      plinko: casino.PLINKO,
      crash: { rate: casino.CRASH_RATE },
    }),
    roulette(uid, body) {
      guard(uid);
      const bets = casino.validateRoulette(body.bets);
      const stake = bets.reduce((s, b) => s + b.amount, 0);
      if (stake > 100000) throw new Error('Max 100,000 per spin');
      return oneShot(uid, stake, () => casino.spinRoulette(bets));
    },
    slots(uid, body) {
      guard(uid);
      const bet = Number(body.bet);
      if (!Number.isInteger(bet) || bet < 5 || bet > 50000 || bet % 5) throw new Error('Bet must be a multiple of 5 (5 lines)');
      return oneShot(uid, bet, () => casino.spinSlots(bet));
    },
    baccarat(uid, body) {
      guard(uid);
      const bets = casino.validateBaccarat(body.bets);
      const stake = Object.values(bets).reduce((a, b) => a + b, 0);
      return oneShot(uid, stake, () => ({ ...casino.playBaccarat(bets, shoe.take()), bets }));
    },
    dice(uid, body) {
      guard(uid);
      const bet = Number(body.bet);
      if (!Number.isInteger(bet) || bet < 1 || bet > 100000) throw new Error('Bet from 1 to 100,000');
      return oneShot(uid, bet, () => casino.rollDice(bet, Number(body.chance), body.over === true));
    },
    plinko(uid, body) {
      guard(uid);
      const bet = Number(body.bet);
      if (!Number.isInteger(bet) || bet < 1 || bet > 100000) throw new Error('Bet from 1 to 100,000');
      return { ...oneShot(uid, bet, () => casino.dropPlinko(bet, body.risk)), risk: body.risk };
    },
    plinkoTables: () => casino.PLINKO,

    // ----- Mines -----
    minesView(uid) {
      const st = minesRounds.get(uid);
      if (!st) return { active: false };
      const n = st.revealed.length;
      return { active: !st.over, bet: st.bet, mines: st.mines, revealed: st.revealed, mult: n ? casino.minesMultiplier(st.mines, n) : 1, next: casino.minesMultiplier(st.mines, n + 1) };
    },
    minesStart(uid, body) {
      guard(uid);
      const cur = minesRounds.get(uid);
      if (cur && !cur.over) throw new Error('Finish your current round first');
      const bet = Number(body.bet), mines = Number(body.mines);
      const st = casino.minesStart(bet, mines); // validates
      if (!wallet.hold(uid, bet)) throw new Error('Not enough credits');
      minesRounds.set(uid, st);
      return { ...this.minesView(uid), credits: credits(uid) };
    },
    minesReveal(uid, body) {
      const st = minesRounds.get(uid);
      if (!st || st.over) throw new Error('Start a round first');
      const r = casino.minesReveal(st, Number(body.cell));
      if (r.bomb || r.done) wallet.settle(uid, st.bet, r.payout);
      const out = { ...r, cell: Number(body.cell), revealed: st.revealed, credits: credits(uid) };
      if (st.over) out.bombs = st.bombs;
      return out;
    },
    minesCashout(uid) {
      const st = minesRounds.get(uid);
      if (!st || st.over) throw new Error('No round to cash out');
      const r = casino.minesCashout(st);
      wallet.settle(uid, st.bet, r.payout);
      return { ...r, bombs: st.bombs, revealed: st.revealed, credits: credits(uid) };
    },

    // ----- Crash -----
    crashView(uid) {
      const st = crashRounds.get(uid);
      if (!st) return { phase: 'idle' };
      this.crashResolve(uid);
      const now = Date.now();
      const v = { phase: st.phase, bet: st.bet, auto: st.auto, startedAt: st.startedAt, now, credits: credits(uid) };
      if (st.phase === 'running') v.mult = casino.crashAt(now - st.startedAt);
      else { v.crash = st.point; v.payout = st.payout; v.cashedAt = st.cashedAt; }
      return v;
    },
    crashResolve(uid) {
      const st = crashRounds.get(uid);
      if (!st || st.phase !== 'running') return;
      const elapsed = Date.now() - st.startedAt;
      if (st.auto && st.auto <= st.point && elapsed >= casino.crashTime(st.auto)) this.crashSettle(uid, st.auto);
      else if (elapsed >= casino.crashTime(st.point)) this.crashSettle(uid, 0);
    },
    crashSettle(uid, mult) {
      const st = crashRounds.get(uid);
      if (!st || st.phase !== 'running') return;
      clearTimeout(st.timer);
      st.phase = mult ? 'cashed' : 'crashed';
      st.cashedAt = mult || null;
      st.payout = mult ? Math.floor(st.bet * mult) : 0;
      wallet.settle(uid, st.bet, st.payout);
    },
    crashStart(uid, body) {
      guard(uid);
      const cur = crashRounds.get(uid);
      if (cur && cur.phase === 'running') { this.crashResolve(uid); if (cur.phase === 'running') throw new Error('Round in progress'); }
      const bet = Number(body.bet);
      if (!Number.isInteger(bet) || bet < 1 || bet > 100000) throw new Error('Bet from 1 to 100,000');
      let auto = body.auto == null || body.auto === '' ? null : Math.floor(Number(body.auto) * 100) / 100;
      if (auto !== null && !(auto >= 1.01 && auto <= 1000)) throw new Error('Auto cash out from 1.01x to 1000x');
      if (!wallet.hold(uid, bet)) throw new Error('Not enough credits');
      const st = { bet, auto, point: casino.crashPoint(), startedAt: Date.now(), phase: 'running' };
      const endMs = Math.min(casino.crashTime(st.point), auto && auto <= st.point ? casino.crashTime(auto) : Infinity);
      st.timer = setTimeout(() => this.crashResolve(uid), endMs + 20);
      crashRounds.set(uid, st);
      return this.crashView(uid);
    },
    crashCashout(uid) {
      const st = crashRounds.get(uid);
      if (!st) throw new Error('No round running');
      this.crashResolve(uid);
      if (st.phase === 'running') {
        const m = casino.crashAt(Date.now() - st.startedAt);
        this.crashSettle(uid, m < st.point ? m : 0);
      }
      return this.crashView(uid);
    },
    pokerState(uid) {
      const h = pokerHands.get(uid);
      return h ? { bet: h.bet, hand: h.hand, pending: true } : { pending: false };
    },
    pokerDeal(uid, body) {
      guard(uid);
      const bet = Number(body.bet);
      if (pokerHands.has(uid)) throw new Error('Finish your current hand first');
      if (!Number.isInteger(bet) || bet < 1 || bet > 50000) throw new Error('Bet from 1 to 50,000');
      if (!wallet.hold(uid, bet)) throw new Error('Not enough credits');
      const h = { bet, ...casino.pokerDeal() };
      pokerHands.set(uid, h);
      return { bet, hand: h.hand, preview: casino.evaluatePoker(h.hand), credits: credits(uid) };
    },
    pokerDraw(uid, body) {
      const h = pokerHands.get(uid);
      if (!h) throw new Error('Deal a hand first');
      const out = casino.pokerDraw(h, body.holds);
      pokerHands.delete(uid);
      const payout = h.bet * out.result.mult;
      wallet.settle(uid, h.bet, payout);
      return { ...out, bet: h.bet, payout, credits: credits(uid) };
    },
  };
}
module.exports = { createGames };
