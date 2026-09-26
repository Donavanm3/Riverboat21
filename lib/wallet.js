'use strict';
// Credits move between `credits` (spendable) and `escrow` (riding on a live hand).
// Escrow is refunded on boot so a crash mid-hand never eats anyone's credits.
class Wallet {
  constructor(store, onChange = () => {}) {
    this.store = store;
    this.onChange = onChange;
    for (const u of Object.values(store.data.users)) {
      if (u.escrow) { u.credits += u.escrow; u.escrow = 0; }
    }
    store.save();
  }
  user(uid) { return this.store.data.users[uid]; }
  static valid(n) { return Number.isInteger(n) && n > 0 && n <= 1e9; }
  changed(uid) { this.store.save(); this.onChange(uid); }
  hold(uid, amt) {
    const u = this.user(uid);
    if (!u || !Wallet.valid(amt) || u.credits < amt) return false;
    u.credits -= amt; u.escrow = (u.escrow || 0) + amt;
    this.changed(uid); return true;
  }
  unhold(uid, amt) {
    const u = this.user(uid);
    if (!u || !Wallet.valid(amt)) return;
    const back = Math.min(amt, u.escrow || 0);
    u.escrow -= back; u.credits += back;
    this.changed(uid);
  }
  settle(uid, stake, payout) {
    const u = this.user(uid);
    if (!u) return;
    u.escrow = Math.max(0, (u.escrow || 0) - stake);
    u.credits += payout;
    u.stats = u.stats || { hands: 0, wagered: 0, won: 0 };
    u.stats.hands++; u.stats.wagered += stake; u.stats.won += payout;
    this.changed(uid);
  }
  debit(uid, amt) {
    const u = this.user(uid);
    if (!u || !Wallet.valid(amt) || u.credits < amt) return false;
    u.credits -= amt; this.changed(uid); return true;
  }
  credit(uid, amt) {
    const u = this.user(uid);
    if (!u || !Wallet.valid(amt)) return false;
    u.credits += amt; this.changed(uid); return true;
  }
}
module.exports = { Wallet };
