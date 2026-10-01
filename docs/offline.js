'use strict';
// Offline mode: runs the real game engine (docs/engine.js, built from lib/) inside the browser.
// Credits are practice credits saved on this device only. No accounts, store, ads or tournaments.
(() => {
  const KEY = 'rb21_offline_v1';
  let storage;
  try { const k = '__rb21o'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); storage = window.localStorage; }
  catch { const m = {}; storage = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }
  const UID = 'local';
  let ready = null;

  function init() {
    if (ready) return ready;
    window.RB21EngineEnv = { BET_WINDOW_MS: '2500', TURN_MS: '60000', RESULT_MS: '2500' };
    const E = window.RB21Engine.require;
    const { ECONOMY, TABLES } = E('./config');
    const { Wallet } = E('./wallet');
    const { TableManager } = E('./tables');
    const { createGames } = E('./games-service');

    let saved = null;
    try { saved = JSON.parse(storage.getItem(KEY) || 'null'); } catch { saved = null; }
    const user = saved && saved.user ? saved.user : { id: UID, name: 'Player', credits: ECONOMY.signupBonus, escrow: 0, createdAt: Date.now() };
    const store = {
      data: { users: { [UID]: user } },
      t: null,
      save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 150); },
      flush() { try { storage.setItem(KEY, JSON.stringify({ user })); } catch { /* storage full or blocked */ } },
    };
    window.addEventListener('pagehide', () => store.flush());

    const listeners = {};
    const fire = (ev, data) => (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
    const wallet = new Wallet(store, () => fire('wallet', { credits: user.credits, escrow: user.escrow || 0 }));
    let watching = null;
    const tables = new TableManager(TABLES, { wallet, onChange: (t) => { if (watching === t.id) fire('table', t.view()); fire('tables', tables.list()); } });
    const games = createGames(wallet);
    const me = () => ({ id: UID, email: '', name: user.name, credits: user.credits, escrow: user.escrow || 0, admin: false, offline: true, stats: user.stats || null,
      nextDaily: (user.lastDaily || 0) + ECONOMY.dailyCooldownMs, nextAd: Infinity, adsToday: 0, inbox: [] });

    const routes = {
      'GET /api/config': () => ({ offline: true, adsenseClient: '', simulateAds: false, storeEnabled: false, packs: [], economy: ECONOMY }),
      'GET /api/me': me,
      'POST /api/bonus/daily': () => {
        if (Date.now() < (user.lastDaily || 0) + ECONOMY.dailyCooldownMs) throw new Error('Daily bonus is not ready yet');
        user.lastDaily = Date.now(); wallet.credit(UID, ECONOMY.dailyBonus); return me();
      },
      'POST /api/bonus/refill': () => {
        if (user.credits + (user.escrow || 0) >= ECONOMY.refillThreshold) throw new Error('Refills are for empty wallets');
        wallet.credit(UID, ECONOMY.refillAmount); return me(); // offline: no cooldown, it’s practice
      },
      'GET /api/tournaments': () => [],
      'GET /api/games/info': () => games.info(),
      'POST /api/games/roulette': (b) => games.roulette(UID, b),
      'POST /api/games/slots': (b) => games.slots(UID, b),
      'POST /api/games/baccarat': (b) => games.baccarat(UID, b),
      'GET /api/games/poker': () => games.pokerState(UID),
      'POST /api/games/poker/deal': (b) => games.pokerDeal(UID, b),
      'POST /api/games/poker/draw': (b) => games.pokerDraw(UID, b),
      'POST /api/games/dice': (b) => games.dice(UID, b),
      'POST /api/games/plinko': (b) => games.plinko(UID, b),
      'GET /api/games/mines': () => games.minesView(UID),
      'POST /api/games/mines/start': (b) => games.minesStart(UID, b),
      'POST /api/games/mines/reveal': (b) => games.minesReveal(UID, b),
      'POST /api/games/mines/cashout': () => games.minesCashout(UID),
      'GET /api/games/crash': () => games.crashView(UID),
      'POST /api/games/crash/start': (b) => games.crashStart(UID, b),
      'POST /api/games/crash/cashout': () => games.crashCashout(UID),
      'POST /api/inbox/clear': () => ({ ok: true }),
    };
    function api(path, body, method) {
      const m = method || (body ? 'POST' : 'GET');
      const fn = routes[`${m} ${path.split('?')[0]}`];
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (!fn) return reject(new Error('Not available offline'));
          try { resolve(JSON.parse(JSON.stringify(fn(body || {})))); } catch (e) { reject(new Error(e.message)); }
        }, 0);
      });
    }
    // Same events as the online socket, handled locally.
    const handlers = {
      'table:watch': ({ tableId }) => { const t = tables.get(tableId); watching = t.id; return t.view(); },
      'table:sit': ({ tableId, seat }) => tables.get(tableId).sit(UID, user.name, seat),
      'table:leave': ({ tableId }) => tables.get(tableId).leave(UID),
      'table:bet': ({ tableId, amount }) => tables.get(tableId).bet(UID, amount),
      'table:clear': ({ tableId }) => tables.get(tableId).clearBet(UID),
      'table:act': ({ tableId, action }) => tables.get(tableId).act(UID, action),
    };
    function socket() {
      const sock = {
        connected: true,
        on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); if (ev === 'tables') setTimeout(() => fn(tables.list()), 0); return sock; },
        emit(ev, data, ack) {
          setTimeout(() => {
            const h = handlers[ev];
            if (!h) return ack && ack({ error: 'Not available offline' });
            try { const out = h(data || {}); ack && ack({ ok: true, data: JSON.parse(JSON.stringify(out === undefined ? null : out)) }); }
            catch (e) { ack && ack({ error: e.message }); }
          }, 0);
        },
        disconnect() { for (const k of Object.keys(listeners)) delete listeners[k]; tables.leaveAll(UID); sock.connected = false; },
      };
      return sock;
    }
    function reset() { storage.removeItem(KEY); }
    ready = { api, socket, me, reset };
    return ready;
  }
  window.RB21Offline = { init };
})();
