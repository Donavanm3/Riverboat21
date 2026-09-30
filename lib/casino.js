'use strict';
// Single-player play-money games. All randomness is server-side (crypto.randomInt).
// Every function returns totals as "payout" = credits handed back, including the stake.
const crypto = require('crypto');
const rnd = (n) => crypto.randomInt(n);
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function deck(decks = 1) {
  const c = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) c.push({ r, s });
  for (let i = c.length - 1; i > 0; i--) { const j = rnd(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c;
}
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

// ---------------- Roulette (European, single zero, RTP 97.3%) ----------------
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const OUTSIDE = {
  red: { pays: 1, win: (n) => RED.has(n) }, black: { pays: 1, win: (n) => n > 0 && !RED.has(n) },
  odd: { pays: 1, win: (n) => n > 0 && n % 2 === 1 }, even: { pays: 1, win: (n) => n > 0 && n % 2 === 0 },
  low: { pays: 1, win: (n) => n >= 1 && n <= 18 }, high: { pays: 1, win: (n) => n >= 19 },
  dozen1: { pays: 2, win: (n) => n >= 1 && n <= 12 }, dozen2: { pays: 2, win: (n) => n >= 13 && n <= 24 }, dozen3: { pays: 2, win: (n) => n >= 25 },
  col1: { pays: 2, win: (n) => n > 0 && n % 3 === 1 }, col2: { pays: 2, win: (n) => n > 0 && n % 3 === 2 }, col3: { pays: 2, win: (n) => n > 0 && n % 3 === 0 },
};
function validateRoulette(bets) {
  if (!Array.isArray(bets) || !bets.length || bets.length > 60) throw new Error('Place at least one bet');
  return bets.map((b) => {
    const amount = Number(b && b.amount);
    if (!isInt(amount, 1, 100000)) throw new Error('Invalid bet amount');
    if (b.type === 'straight') {
      const n = Number(b.value);
      if (!isInt(n, 0, 36)) throw new Error('Pick a number from 0 to 36');
      return { type: 'straight', value: n, amount };
    }
    if (!OUTSIDE[b.type]) throw new Error('Unknown bet');
    return { type: b.type, amount };
  });
}
function spinRoulette(bets, number = rnd(37)) {
  const results = bets.map((b) => {
    const pays = b.type === 'straight' ? 35 : OUTSIDE[b.type].pays;
    const win = b.type === 'straight' ? b.value === number : OUTSIDE[b.type].win(number);
    return { ...b, win, payout: win ? b.amount * (pays + 1) : 0 };
  });
  return { number, color: number === 0 ? 'green' : RED.has(number) ? 'red' : 'black', results, payout: results.reduce((s, r) => s + r.payout, 0) };
}

// ---------------- Slots (3x3, 5 lines, RTP ~96.4%) ----------------
const SYMBOLS = [
  { id: 'cherry', w: 30, three: 8 }, { id: 'lemon', w: 25, three: 15 }, { id: 'bell', w: 18, three: 30 },
  { id: 'bar', w: 14, three: 50 }, { id: 'seven', w: 8, three: 150 }, { id: 'diamond', w: 5, three: 500 },
];
const CHERRY_TWO = 1; // first two cells cherry, third not: pays 1x line bet
const W_TOTAL = SYMBOLS.reduce((s, x) => s + x.w, 0);
const LINES = [[[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]], [[2, 0], [1, 1], [0, 2]]];
function pickSymbol() { let r = rnd(W_TOTAL); for (const s of SYMBOLS) { if (r < s.w) return s.id; r -= s.w; } return SYMBOLS[0].id; }
function spinSlots(bet, grid) {
  if (!isInt(bet, 5, 50000) || bet % 5) throw new Error('Bet must be a multiple of 5 (5 lines)');
  const g = grid || [0, 1, 2].map(() => [0, 1, 2].map(pickSymbol)); // g[row][col]
  const lineBet = bet / 5;
  const wins = [];
  LINES.forEach((cells, i) => {
    const [a, b, c] = cells.map(([r, col]) => g[r][col]);
    let mult = 0;
    if (a === b && b === c) mult = SYMBOLS.find((s) => s.id === a).three;
    else if (a === 'cherry' && b === 'cherry') mult = CHERRY_TWO;
    if (mult) wins.push({ line: i, symbol: a, mult, payout: lineBet * mult });
  });
  return { grid: g, wins, payout: wins.reduce((s, w) => s + w.payout, 0) };
}
function slotsRTP() {
  const p = (id) => SYMBOLS.find((s) => s.id === id).w / W_TOTAL;
  return SYMBOLS.reduce((s, x) => s + p(x.id) ** 3 * x.three, 0) + p('cherry') ** 2 * (1 - p('cherry')) * CHERRY_TWO;
}

// ---------------- Video poker (Jacks or Better 9/6, RTP ~99.5% with perfect play) ----------------
const PAYTABLE = [
  ['royal', 'Royal Flush', 800], ['straightflush', 'Straight Flush', 50], ['four', 'Four of a Kind', 25],
  ['fullhouse', 'Full House', 9], ['flush', 'Flush', 6], ['straight', 'Straight', 4],
  ['three', 'Three of a Kind', 3], ['twopair', 'Two Pair', 2], ['jacks', 'Jacks or Better', 1],
];
const rv = (r) => RANKS.indexOf(r) + 2;
function evaluatePoker(cards) {
  const vals = cards.map((c) => rv(c.r)).sort((a, b) => a - b);
  const counts = {}; for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.values(counts).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(vals)];
  const wheel = uniq.join() === '2,3,4,5,14';
  const straight = uniq.length === 5 && (vals[4] - vals[0] === 4 || wheel);
  let key = null;
  if (straight && flush) key = vals[0] === 10 ? 'royal' : 'straightflush';
  else if (groups[0] === 4) key = 'four';
  else if (groups[0] === 3 && groups[1] === 2) key = 'fullhouse';
  else if (flush) key = 'flush';
  else if (straight) key = 'straight';
  else if (groups[0] === 3) key = 'three';
  else if (groups[0] === 2 && groups[1] === 2) key = 'twopair';
  else if (groups[0] === 2) { const pair = Number(Object.keys(counts).find((v) => counts[v] === 2)); if (pair >= 11) key = 'jacks'; }
  const row = PAYTABLE.find((p) => p[0] === key);
  return row ? { key, name: row[1], mult: row[2] } : { key: null, name: 'No win', mult: 0 };
}
function pokerDeal() { const d = deck(1); return { hand: d.splice(0, 5), deck: d }; }
function pokerDraw(state, holds) {
  if (!Array.isArray(holds) || holds.length !== 5) throw new Error('Pick which cards to hold');
  const hand = state.hand.map((c, i) => (holds[i] === true ? c : state.deck.shift()));
  return { hand, result: evaluatePoker(hand) };
}

// ---------------- Baccarat (8 decks, standard drawing rules) ----------------
const bv = (c) => (['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : c.r === 'A' ? 1 : Number(c.r));
const btotal = (cards) => cards.reduce((s, c) => s + bv(c), 0) % 10;
function bankerDraws(b, p3) {
  if (p3 === null) return b <= 5;
  if (b <= 2) return true;
  if (b === 3) return p3 !== 8;
  if (b === 4) return p3 >= 2 && p3 <= 7;
  if (b === 5) return p3 >= 4 && p3 <= 7;
  if (b === 6) return p3 === 6 || p3 === 7;
  return false;
}
function validateBaccarat(bets) {
  const out = {};
  for (const k of ['player', 'banker', 'tie']) {
    const v = Number((bets || {})[k] || 0);
    if (!isInt(v, 0, 100000)) throw new Error('Invalid bet amount');
    if (v) out[k] = v;
  }
  if (!Object.keys(out).length) throw new Error('Place a bet on Player, Banker, or Tie');
  return out;
}
function playBaccarat(bets, shoe) {
  const draw = () => shoe.pop();
  const player = [draw(), draw()], banker = [draw(), draw()];
  let p = btotal(player), b = btotal(banker);
  if (p < 8 && b < 8) {
    let p3 = null;
    if (p <= 5) { const c = draw(); player.push(c); p3 = bv(c); p = btotal(player); }
    if (bankerDraws(b, p3)) { banker.push(draw()); b = btotal(banker); }
  }
  const winner = p > b ? 'player' : b > p ? 'banker' : 'tie';
  let payout = 0;
  if (bets.player) payout += winner === 'player' ? bets.player * 2 : winner === 'tie' ? bets.player : 0;
  if (bets.banker) payout += winner === 'banker' ? bets.banker + Math.floor(bets.banker * 0.95) : winner === 'tie' ? bets.banker : 0;
  if (bets.tie) payout += winner === 'tie' ? bets.tie * 9 : 0;
  return { player, banker, playerTotal: p, bankerTotal: b, winner, payout };
}
class BaccaratShoe {
  constructor() { this.cards = deck(8); }
  take() { if (this.cards.length < 60) this.cards = deck(8); return this.cards; }
}

module.exports = {
  validateRoulette, spinRoulette, spinSlots, slotsRTP, SYMBOLS, LINES, CHERRY_TWO,
  PAYTABLE, evaluatePoker, pokerDeal, pokerDraw,
  validateBaccarat, playBaccarat, BaccaratShoe, bankerDraws, btotal, RED,
};
