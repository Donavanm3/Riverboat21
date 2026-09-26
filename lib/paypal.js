'use strict';
// Minimal PayPal REST client (Orders v2 + refunds) using Node's built-in fetch. No SDK needed.
const BASES = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };

class PayPal {
  constructor({ clientId, secret, env = 'sandbox', base }) {
    this.clientId = clientId; this.secret = secret;
    this.base = (base || BASES[env] || BASES.sandbox).replace(/\/$/, '');
    this.cached = null;
  }
  async token() {
    if (this.cached && this.cached.exp > Date.now() + 60000) return this.cached.value;
    const res = await fetch(this.base + '/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(this.clientId + ':' + this.secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error('PayPal authentication failed');
    this.cached = { value: data.access_token, exp: Date.now() + (data.expires_in || 3000) * 1000 };
    return this.cached.value;
  }
  async call(method, path, body, requestId) {
    const res = await fetch(this.base + path, {
      method,
      headers: { Authorization: 'Bearer ' + (await this.token()), 'Content-Type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.details?.[0]?.description || data.message || `PayPal error ${res.status}`);
      err.issue = data.details?.[0]?.issue; err.status = res.status; throw err;
    }
    return data;
  }
  createOrder({ amountCents, description, referenceId, customId, requestId }) {
    return this.call('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: referenceId, custom_id: customId, description: description.slice(0, 127),
        amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) },
      }],
      application_context: { brand_name: 'Riverboat 21', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
    }, requestId);
  }
  // Returns { status, captureId, amountCents } for a completed capture.
  async capture(orderId) {
    let data;
    try { data = await this.call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, 'cap-' + orderId); }
    catch (e) {
      if (e.issue !== 'ORDER_ALREADY_CAPTURED') throw e;
      data = await this.call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    }
    const cap = data.purchase_units?.[0]?.payments?.captures?.[0];
    return {
      status: cap?.status || data.status,
      captureId: cap?.id,
      amountCents: cap ? Math.round(Number(cap.amount.value) * 100) : 0,
      currency: cap?.amount?.currency_code,
    };
  }
  refund(captureId) { return this.call('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {}, 'ref-' + captureId); }
}
module.exports = { PayPal };
