'use strict';
// All amounts are play-money credits. Credits have no cash value and can never be withdrawn.
const ECONOMY = {
  signupBonus: 1000,
  dailyBonus: 500,
  dailyCooldownMs: 20 * 3600 * 1000,
  adReward: 150,
  adCooldownMs: 2 * 60 * 1000,
  adDailyCap: 10,
  refillAmount: 250,
  refillThreshold: 10,
  refillCooldownMs: 3600 * 1000,
};

const CREDIT_PACKS = [
  { id: 'pack_5k', credits: 5000, priceCents: 99, label: 'Pocket stack' },
  { id: 'pack_30k', credits: 30000, priceCents: 499, label: 'Table stack' },
  { id: 'pack_75k', credits: 75000, priceCents: 999, label: 'High roller stack' },
  { id: 'pack_200k', credits: 200000, priceCents: 1999, label: 'Vault' },
];

const TABLES = [
  { id: 't1', name: 'Bluegrass', min: 10, max: 500 },
  { id: 't2', name: 'Ohio River', min: 10, max: 500 },
  { id: 't3', name: 'Riverboat', min: 50, max: 2500 },
  { id: 't4', name: 'Derby Room', min: 250, max: 10000 },
];

module.exports = { ECONOMY, CREDIT_PACKS, TABLES };
