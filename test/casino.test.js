'use strict';
const assert = require('assert');
const c = require('../lib/casino');
const C = (s) => s.split(' ').map((x) => ({ r: x.slice(0, -1), s: x.slice(-1) }));

// Poker hand ranking
const ev = (s) => c.evaluatePoker(C(s)).key;
assert.strictEqual(ev('10S JS QS KS AS'), 'royal');
assert.strictEqual(ev('AH 2H 3H 4H 5H'), 'straightflush');
assert.strictEqual(ev('9C 9D 9H 9S 2C'), 'four');
assert.strictEqual(ev('3C 3D 3H 7S 7C'), 'fullhouse');
assert.strictEqual(ev('2D 7D 9D JD KD'), 'flush');
assert.strictEqual(ev('AS 2D 3C 4H 5S'), 'straight');
assert.strictEqual(ev('10S JD QC KH AS'), 'straight');
assert.strictEqual(ev('QS KD AC 2H 3S'), null, 'no wraparound straight');
assert.strictEqual(ev('8C 8D 8H KS 2C'), 'three');
assert.strictEqual(ev('4C 4D JH JS 2C'), 'twopair');
assert.strictEqual(ev('JC JD 5H 7S 2C'), 'jacks');
assert.strictEqual(ev('10C 10D 5H 7S 2C'), null, 'tens do not pay');

// Poker draw keeps held cards
const st = c.pokerDeal();
const kept = st.hand.slice();
const d = c.pokerDraw({ hand: st.hand, deck: st.deck.slice() }, [true, false, true, false, true]);
assert.deepStrictEqual([d.hand[0], d.hand[2], d.hand[4]], [kept[0], kept[2], kept[4]]);
assert.throws(() => c.pokerDraw(st, [true]));

// Roulette payouts
let r = c.spinRoulette(c.validateRoulette([{ type: 'straight', value: 17, amount: 10 }, { type: 'red', amount: 10 }, { type: 'col2', amount: 10 }]), 17);
assert.strictEqual(r.color, 'black'); assert.strictEqual(r.payout, 360 + 0 + 30);
r = c.spinRoulette(c.validateRoulette([{ type: 'even', amount: 10 }, { type: 'low', amount: 10 }]), 0);
assert.strictEqual(r.payout, 0, 'zero loses outside bets');
assert.throws(() => c.validateRoulette([{ type: 'straight', value: 37, amount: 1 }]));
assert.throws(() => c.validateRoulette([{ type: 'red', amount: 1.5 }]));
// Exact RTP of a red bet and a straight bet
let red = 0, str = 0;
for (let n = 0; n <= 36; n++) { red += c.spinRoulette([{ type: 'red', amount: 1 }], n).payout; str += c.spinRoulette([{ type: 'straight', value: 5, amount: 1 }], n).payout; }
assert.strictEqual(red, 36); assert.strictEqual(str, 36); // 36/37 = 97.3%

// Slots
const g = [['seven', 'seven', 'seven'], ['cherry', 'cherry', 'bell'], ['bar', 'lemon', 'diamond']];
const s = c.spinSlots(50, g);
assert.strictEqual(s.payout, 10 * 150 + 10 * 1);
assert.throws(() => c.spinSlots(7));
let paid = 0, bet = 0; const N = 200000;
for (let i = 0; i < N; i++) { paid += c.spinSlots(5).payout; bet += 5; }
const sim = paid / bet;
assert.ok(Math.abs(sim - c.slotsRTP()) < 0.03, `slots RTP sim ${sim}`);

// Baccarat rules
const hand = (cards) => ({ pop: (() => { const q = C(cards).reverse(); return () => q.pop(); })() });
// order drawn: P1 P2 B1 B2 [P3] [B3]; shoe.pop() takes from the end, so build array accordingly
const shoeOf = (s) => C(s).reverse();
let b = c.playBaccarat({ player: 10 }, shoeOf('9S KD 3C 4H'));
assert.strictEqual(b.winner, 'player'); assert.strictEqual(b.playerTotal, 9); assert.strictEqual(b.payout, 20);
b = c.playBaccarat({ banker: 100 }, shoeOf('2S 3D 3C 3H 8C 5D')); // P=5 draws 8 ->3; B=6 stands vs 8
assert.strictEqual(b.player.length, 3); assert.strictEqual(b.banker.length, 2);
assert.strictEqual(b.winner, 'banker'); assert.strictEqual(b.payout, 195);
b = c.playBaccarat({ player: 10, banker: 10, tie: 10 }, shoeOf('7S KD 7C KH'));
assert.strictEqual(b.winner, 'tie'); assert.strictEqual(b.payout, 10 + 10 + 90);
assert.strictEqual(c.bankerDraws(3, 8), false); assert.strictEqual(c.bankerDraws(6, 7), true); assert.strictEqual(c.bankerDraws(5, null), true);
// Baccarat banker-bet house edge should be ~1.06%
const shoe = new c.BaccaratShoe(); let bk = 0;
for (let i = 0; i < 200000; i++) bk += c.playBaccarat({ banker: 100 }, shoe.take()).payout;
const bkRtp = bk / (200000 * 100);
assert.ok(bkRtp > 0.97 && bkRtp < 1.0, 'banker RTP ' + bkRtp);
console.log(`casino ok (slots RTP ${sim.toFixed(4)}, banker RTP ${bkRtp.toFixed(4)})`);
