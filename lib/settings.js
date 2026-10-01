'use strict';
// Admin-editable IDs and keys (ads, PayPal). A value saved in the admin panel wins; otherwise the
// Render environment variable is used. The PayPal secret is stored encrypted (AES-256-GCM, key derived
// from JWT_SECRET) and is never sent back to the browser.
const crypto = require('crypto');

const FIELDS = {
  adsenseClient: { env: 'ADSENSE_CLIENT', re: /^ca-pub-\d{10,20}$/, hint: 'Looks like ca-pub-1234567890123456' },
  adsenseBannerSlot: { env: 'ADSENSE_BANNER_SLOT', re: /^\d{6,20}$/, hint: 'A number like 1234567890' },
  admobRewardedId: { env: 'ADMOB_REWARDED_ID', re: /^ca-app-pub-\d{10,20}\/\d{6,20}$/, hint: 'Looks like ca-app-pub-1234567890123456/1234567890' },
  admobRewardedIdIos: { env: 'ADMOB_REWARDED_ID_IOS', re: /^ca-app-pub-\d{10,20}\/\d{6,20}$/, hint: 'Looks like ca-app-pub-1234567890123456/1234567890' },
  paypalClientId: { env: 'PAYPAL_CLIENT_ID', re: /^[A-Za-z0-9_-]{20,200}$/, hint: 'The long Client ID from developer.paypal.com' },
  paypalEnv: { env: 'PAYPAL_ENV', re: /^(sandbox|live)$/, hint: 'sandbox or live' },
  adsTestMode: { env: 'ADS_TEST_MODE', bool: true },
  simulateAds: { env: 'SIMULATE_ADS', bool: true },
};
const SECRET = { key: 'paypalSecret', env: 'PAYPAL_CLIENT_SECRET', re: /^[A-Za-z0-9_-]{20,200}$/ };

class Settings {
  constructor(store, jwtSecret, onChange = () => {}) {
    this.store = store; this.onChange = onChange;
    this.key = crypto.createHash('sha256').update('rb21-settings:' + jwtSecret).digest();
    store.data.settings = store.data.settings || {};
  }
  get saved() { return this.store.data.settings; }
  encrypt(text) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }
  decrypt(blob) {
    try {
      const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv); d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
    } catch { return ''; } // JWT_SECRET changed: treat as not set
  }
  value(name) {
    const f = FIELDS[name], s = this.saved[name];
    if (s !== undefined && s !== '') return f.bool ? s === true : s;
    const e = process.env[f.env];
    return f.bool ? e === 'true' : (e || '');
  }
  paypalSecret() { return (this.saved.paypalSecretEnc && this.decrypt(this.saved.paypalSecretEnc)) || process.env[SECRET.env] || ''; }
  all() {
    const out = {};
    for (const k of Object.keys(FIELDS)) out[k] = this.value(k);
    if (!out.paypalEnv) out.paypalEnv = 'sandbox';
    return out;
  }
  // What the admin panel sees: values, where each comes from, and only whether the secret is set.
  adminView() {
    const source = {};
    for (const [k, f] of Object.entries(FIELDS)) source[k] = this.saved[k] !== undefined && this.saved[k] !== '' ? 'admin' : process.env[f.env] ? 'render' : 'unset';
    const secretSource = this.saved.paypalSecretEnc && this.decrypt(this.saved.paypalSecretEnc) ? 'admin' : process.env[SECRET.env] ? 'render' : 'unset';
    return { values: this.all(), source, paypalSecretSet: secretSource !== 'unset', paypalSecretSource: secretSource,
      secretUnreadable: !!this.saved.paypalSecretEnc && !this.decrypt(this.saved.paypalSecretEnc), updatedAt: this.saved.updatedAt || null };
  }
  // Empty string = clear the saved value (fall back to Render). Booleans are true/false.
  update(input) {
    const next = { ...this.saved };
    for (const [k, f] of Object.entries(FIELDS)) {
      if (!(k in input)) continue;
      if (f.bool) { next[k] = input[k] === true; continue; }
      const v = String(input[k] ?? '').trim();
      if (v && !f.re.test(v)) throw new Error(`${k}: ${f.hint}`);
      if (v) next[k] = v; else delete next[k];
    }
    if (input.clearPaypalSecret === true) delete next.paypalSecretEnc;
    else if (typeof input.paypalSecret === 'string' && input.paypalSecret.trim()) {
      const v = input.paypalSecret.trim();
      if (!SECRET.re.test(v)) throw new Error('paypalSecret: the Secret from developer.paypal.com (letters, numbers, - and _)');
      next.paypalSecretEnc = this.encrypt(v);
    }
    next.updatedAt = Date.now();
    this.store.data.settings = next; this.store.save(); this.onChange();
    return this.adminView();
  }
}
module.exports = { Settings, FIELDS };
