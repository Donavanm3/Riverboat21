'use strict';
// Casino game handlers shared by the online server (server.js) and the offline app (docs/offline.js).
const casino = require('./casino');

function createGames(wallet) {
  const shoe = new casino.BaccaratShoe();
  const pokerHands = new Map(); // uid -> { bet, hand, deck }; the bet sits in escrow until the draw
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
