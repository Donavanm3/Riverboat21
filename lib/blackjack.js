'use strict';
const crypto = require('crypto');
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const cardValue = (r) => (r === 'A' ? 11 : ['J', 'Q', 'K'].includes(r) ? 10 : Number(r));
function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardValue(c.r); if (c.r === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

class Shoe {
  constructor(decks = 6, penetration = 0.75) { this.decks = decks; this.penetration = penetration; this.shuffle(); }
  shuffle() {
    const c = [];
    for (let d = 0; d < this.decks; d++) for (const s of SUITS) for (const r of RANKS) c.push({ r, s });
    for (let i = c.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
    this.cards = c; this.total = c.length;
  }
  needsShuffle() { return this.cards.length < this.total * (1 - this.penetration); }
  draw() { if (!this.cards.length) this.shuffle(); return this.cards.pop(); }
}

const newHand = (owner, seat, bet) => ({ owner, seat, bet, cards: [], done: false, doubled: false, fromSplit: false, splitAces: false, result: null, payout: 0 });

// Rules: 6 decks, dealer stands on all 17s, dealer peeks on A/10, blackjack pays 3:2,
// double on any two cards (incl. after split), one split per player, split aces get one card each.
class Round {
  constructor(shoe, seats) {
    if (shoe.needsShuffle()) shoe.shuffle();
    this.shoe = shoe;
    this.hands = seats.map((s) => newHand(s.owner, s.seat, s.bet));
    this.dealer = []; this.turn = 0; this.phase = 'playing';
  }
  deal() {
    for (let i = 0; i < 2; i++) {
      for (const h of this.hands) h.cards.push(this.shoe.draw());
      this.dealer.push(this.shoe.draw());
    }
    for (const h of this.hands) if (isBlackjack(h.cards)) h.done = true;
    if (cardValue(this.dealer[0].r) >= 10 && isBlackjack(this.dealer)) {
      for (const h of this.hands) h.done = true;
      this.finish(); return;
    }
    this.advance();
  }
  current() { return this.phase === 'playing' ? this.hands[this.turn] || null : null; }
  allowed(h) {
    if (!h) return [];
    const a = ['hit', 'stand'];
    if (h.cards.length === 2 && !h.splitAces) {
      a.push('double');
      const ownerHands = this.hands.filter((x) => x.owner === h.owner).length;
      if (!h.fromSplit && ownerHands < 2 && cardValue(h.cards[0].r) === cardValue(h.cards[1].r)) a.push('split');
    }
    return a;
  }
  extraCost(action) {
    const h = this.current();
    return h && (action === 'double' || action === 'split') ? h.bet : 0;
  }
  act(owner, action) {
    const h = this.current();
    if (!h || h.owner !== owner) throw new Error('Not your turn');
    if (!this.allowed(h).includes(action)) throw new Error('That move is not allowed here');
    if (action === 'hit') {
      h.cards.push(this.shoe.draw());
      if (handValue(h.cards).total >= 21) h.done = true;
    } else if (action === 'stand') {
      h.done = true;
    } else if (action === 'double') {
      h.bet *= 2; h.doubled = true; h.cards.push(this.shoe.draw()); h.done = true;
    } else if (action === 'split') {
      const nh = newHand(h.owner, h.seat, h.bet);
      nh.cards.push(h.cards.pop());
      h.fromSplit = nh.fromSplit = true;
      h.cards.push(this.shoe.draw()); nh.cards.push(this.shoe.draw());
      if (h.cards[0].r === 'A') { h.splitAces = nh.splitAces = true; h.done = nh.done = true; }
      else {
        if (handValue(h.cards).total === 21) h.done = true;
        if (handValue(nh.cards).total === 21) nh.done = true;
      }
      this.hands.splice(this.turn + 1, 0, nh);
    }
    this.advance();
  }
  forceStand() { const h = this.current(); if (h) { h.done = true; this.advance(); } }
  advance() {
    while (this.turn < this.hands.length && this.hands[this.turn].done) this.turn++;
    if (this.turn >= this.hands.length) this.dealerPlay();
  }
  dealerPlay() {
    const live = this.hands.some((h) => handValue(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.fromSplit));
    if (live) while (handValue(this.dealer).total < 17) this.dealer.push(this.shoe.draw());
    this.finish();
  }
  finish() {
    const d = handValue(this.dealer).total, dBJ = isBlackjack(this.dealer);
    for (const h of this.hands) {
      const p = handValue(h.cards).total, pBJ = isBlackjack(h.cards) && !h.fromSplit;
      if (p > 21) { h.result = 'bust'; h.payout = 0; }
      else if (pBJ && dBJ) { h.result = 'push'; h.payout = h.bet; }
      else if (pBJ) { h.result = 'blackjack'; h.payout = h.bet + Math.floor(h.bet * 1.5); }
      else if (dBJ) { h.result = 'lose'; h.payout = 0; }
      else if (d > 21 || p > d) { h.result = 'win'; h.payout = h.bet * 2; }
      else if (p === d) { h.result = 'push'; h.payout = h.bet; }
      else { h.result = 'lose'; h.payout = 0; }
    }
    this.phase = 'done'; this.turn = -1;
  }
  stakeFor(owner) { return this.hands.filter((h) => h.owner === owner).reduce((s, h) => s + h.bet, 0); }
  payoutFor(owner) { return this.hands.filter((h) => h.owner === owner).reduce((s, h) => s + h.payout, 0); }
  owners() { return [...new Set(this.hands.map((h) => h.owner))]; }
  view() {
    const reveal = this.phase === 'done';
    return {
      phase: this.phase,
      turn: this.phase === 'playing' ? this.turn : -1,
      dealer: reveal
        ? { cards: this.dealer, total: handValue(this.dealer).total }
        : { cards: [this.dealer[0], { hidden: true }], total: cardValue(this.dealer[0].r) },
      hands: this.hands.map((h) => {
        const v = handValue(h.cards);
        return { owner: h.owner, seat: h.seat, bet: h.bet, cards: h.cards, total: v.total, soft: v.soft, done: h.done, result: h.result, payout: h.payout };
      }),
      allowed: this.allowed(this.current()),
    };
  }
}
module.exports = { Shoe, Round, handValue, isBlackjack, cardValue };
