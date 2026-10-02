'use strict';
const assert = require('assert');
const { Money } = require('../lib/money');
const store = { data: { users: {}, emailIndex: {} }, save() {} };
const mk = (id, email) => { store.data.users[id] = { id, email, name: id, createdAt: Date.now() }; store.data.emailIndex[email] = id; };
mk('ref', 'ref@x.dev'); mk('buyer', 'buyer@x.dev'); mk('creator', 'cr@x.dev'); mk('old', 'old@x.dev');
const m = new Money(store);

// joining needs 18+ and terms
assert.throws(() => m.join('ref', {}), /18\+/);
m.join('ref', { adult: true, accept: true });
const code = m.codeOf('ref'); assert.match(code, /^[0-9A-F]{6}$/);
m.join('ref', { adult: true, accept: true }); assert.strictEqual(m.codeOf('ref'), code, 'same code on rejoin');

// referral attach rules
assert.strictEqual(m.attachReferral('ref', code), false, 'no self-referral');
assert.strictEqual(m.attachReferral('buyer', 'NOPE'), false);
assert.strictEqual(m.attachReferral('buyer', code.toLowerCase()), true);

// commission: 20% default, held 30 days, voided on refund
let e = m.onPurchase('buyer', 'o1', 499, 'cap1');
assert.strictEqual(e.cents, 99); assert.strictEqual(m.balances('ref').pendingCents, 99);
assert.strictEqual(m.voidSource('cap1'), 1); assert.strictEqual(m.balances('ref').pendingCents, 0);
e = m.onPurchase('buyer', 'o2', 1999, 'cap2'); assert.strictEqual(e.cents, 399);
assert.strictEqual(m.onPurchase('ref', 'o3', 999, 'cap3'), null, 'no commission without a referrer');
store.data.users.old.createdAt = Date.now() - 400 * 864e5; m.attachReferral('old', code);
assert.strictEqual(m.onPurchase('old', 'o4', 999, 'cap4'), null, 'outside the 365-day window');

// creator code with custom rate overrides default
m.setCreatorCode('cr@x.dev', 'deerai', 30);
assert.throws(() => m.setCreatorCode('ref@x.dev', 'DEERAI', 10), /someone else/);
mk('fan', 'fan@x.dev'); assert.ok(m.attachReferral('fan', 'DeerAI'));
assert.strictEqual(m.onPurchase('fan', 'o5', 1000, 'cap5').cents, 300);

// payouts: need available balance >= minimum, W-9 before paying
assert.throws(() => m.requestPayout('ref', 'pay@x.dev'), /Minimum payout/);
for (const x of store.data.earnings) x.availableAt = Date.now() - 1; // hold period over
assert.strictEqual(m.balances('ref').availableCents, 399);
m.updateSettings({ minPayoutCents: 300 });
const p = m.requestPayout('ref', 'Pay@X.dev');
assert.strictEqual(p.cents, 399); assert.strictEqual(m.balances('ref').requestedCents, 399);
assert.throws(() => m.requestPayout('ref', 'pay@x.dev'), /already/);
assert.throws(() => m.settlePayout(p.id, true), /W-9/);
m.settlePayout(p.id, false, 'wrong email'); assert.strictEqual(m.balances('ref').availableCents, 399, 'rejected payout returns balance');
const p2 = m.requestPayout('ref', 'pay@x.dev'); m.setW9('ref', true); m.settlePayout(p2.id, true, 'PayPal txn 123');
assert.strictEqual(m.balances('ref').paidCents, 399); assert.strictEqual(m.paidThisYear('ref'), 399);

// contests / bounties / jobs
assert.throws(() => m.createOpp({ kind: 'contest', title: 'Fan art', description: 'Draw the riverboat logo', reward: '$50' }), /official rules/);
const o = m.createOpp({ kind: 'contest', title: 'Fan art', description: 'Draw the riverboat logo', reward: '$50 to the best entry', rules: 'Free to enter. 18+. Judged on creativity by the Riverboat team. Ends Nov 1.' });
assert.throws(() => m.submit('buyer', o.id, { link: 'https://x.dev/art.png' }), /18/);
assert.throws(() => m.submit('buyer', o.id, { link: 'javascript:alert(1)', adult: true }), /https/);
const s = m.submit('buyer', o.id, { link: 'https://x.dev/art.png', adult: true });
m.award(s.id, 5000); assert.throws(() => m.award(s.id, 5000), /Already/);
assert.strictEqual(m.balances('buyer').availableCents, 5000, 'awards are available right away');
const bug = m.createOpp({ kind: 'bounty', title: 'Find bugs', description: 'Report a real bug with steps', reward: '$5–$100 per bug' });
m.closeOpp(bug.id); assert.throws(() => m.submit('buyer', bug.id, { message: 'found one here', adult: true }), /closed/);
m.tournamentPrize('fan', 2500, 'Cash Cup', 't1'); assert.strictEqual(m.balances('fan').availableCents, 2500);
const av = m.adminView(); assert.ok(av.codes.some((c) => c.code === 'DEERAI'));
console.log('money ok');
