'use strict';
const assert = require('assert');
const { Shoe, Round, handValue } = require('../lib/blackjack');
const C = (s) => s.split(' ').map((x) => ({ r: x.slice(0, -1), s: x.slice(-1) }));
// Stack a shoe: cards are drawn with pop(), so reverse the intended draw order.
function stacked(order) { const s = new Shoe(1); s.cards = C(order).reverse().concat([]); s.total = 1e9; s.needsShuffle = () => false; const extra = new Shoe(6).cards; s.cards = extra.concat(s.cards); return s; }

assert.deepStrictEqual(handValue(C('AS KH')), { total: 21, soft: true });
assert.strictEqual(handValue(C('AS AH 9C')).total, 21);
assert.strictEqual(handValue(C('KS QH 5C')).total, 25);

// deal order: p1, dealer, p1, dealer
let r = new Round(stacked('AS 9H KD 7C'), [{ owner: 'a', seat: 0, bet: 100 }]); r.deal();
assert.strictEqual(r.phase, 'done'); assert.strictEqual(r.hands[0].result, 'blackjack'); assert.strictEqual(r.hands[0].payout, 250);

r = new Round(stacked('9S AH 9D KC'), [{ owner: 'a', seat: 0, bet: 100 }]); r.deal();
assert.strictEqual(r.phase, 'done'); assert.strictEqual(r.hands[0].result, 'lose');

r = new Round(stacked('8S 6H 8D KC 3S 10D 10C'), [{ owner: 'a', seat: 0, bet: 50 }]); r.deal();
assert.ok(r.allowed(r.current()).includes('split'));
assert.strictEqual(r.extraCost('split'), 50);
r.act('a', 'split'); // hands: 8+3, 8+10
assert.strictEqual(r.hands.length, 2);
r.act('a', 'double'); // 8 3 10 = 21
r.act('a', 'stand'); // 18 ; dealer 16 draws...
assert.strictEqual(r.phase, 'done');
assert.strictEqual(r.hands[0].bet, 100);
assert.throws(() => r.act('a', 'hit'));

// wrong owner / illegal move
r = new Round(stacked('5S 6H 7D 9C'), [{ owner: 'a', seat: 0, bet: 10 }, { owner: 'b', seat: 1, bet: 10 }]);
r.deal();
assert.throws(() => r.act('b', 'hit'), /Not your turn/);
assert.throws(() => r.act('a', 'split'), /not allowed/);

// Fuzz: random play, check invariants on 20k rounds.
const shoe = new Shoe(6); let hands = 0;
for (let i = 0; i < 20000; i++) {
  const seats = Array.from({ length: 1 + (i % 5) }, (_, k) => ({ owner: 'p' + k, seat: k, bet: 10 }));
  const rd = new Round(shoe, seats); rd.deal();
  let guard = 0;
  while (rd.phase === 'playing') {
    const h = rd.current(); const acts = rd.allowed(h);
    rd.act(h.owner, acts[Math.floor(Math.random() * acts.length)]);
    assert.ok(++guard < 100);
  }
  const d = handValue(rd.dealer).total;
  for (const h of rd.hands) {
    hands++;
    assert.ok([0, h.bet, h.bet * 2, h.bet + Math.floor(h.bet * 1.5)].includes(h.payout));
    if (handValue(h.cards).total > 21) assert.strictEqual(h.payout, 0);
  }
  const live = rd.hands.some((h) => handValue(h.cards).total <= 21);
  if (live && rd.dealer.length > 2) assert.ok(handValue(rd.dealer.slice(0, -1)).total < 17);
  assert.ok(!live || d >= 17 || rd.hands.every((h) => h.result === 'blackjack' || h.result === 'bust'));
}
console.log(`engine ok (${hands} hands fuzzed)`);
