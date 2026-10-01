'use strict';
(() => {
// Some embeds (Google Sites, sandboxed iframes) block storage. Fall back to memory instead of crashing.
const safeStorage = (() => {
  try { const k = '__rb21'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return window.localStorage; }
  catch { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, memoryOnly: true }; }
})();
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString();
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RESULT = { win: 'Win', blackjack: 'Blackjack!', push: 'Push', lose: 'Lose', bust: 'Bust' };

const API = String(window.RB21_API || '').replace(/\/$/, '');
const money = (c) => '$' + (c / 100).toFixed(2);
let token = safeStorage.getItem('rb21_token');
let offline = safeStorage.getItem('rb21_mode') === 'offline';
// Running inside the Android/iOS app (Capacitor)?
const isApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
document.body.classList.toggle('is-app', isApp);
const AdMob = isApp && window.Capacitor.Plugins ? window.Capacitor.Plugins.AdMob : null;
const local = () => window.RB21Offline.init();
let me = null, cfg = null, socket = null, table = null, tour = null, tourBet = 0;
let authMode = 'login';

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
async function api(path, body, method) {
  if (offline) return local().api(path, body, method);
  const res = await fetch(API + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const emit = (ev, data) => new Promise((resolve, reject) => socket.emit(ev, data, (r) => (r && r.error ? reject(new Error(r.error)) : resolve(r && r.data))));
const tryEmit = (ev, data) => emit(ev, data).catch((e) => toast(e.message));

// Back button (browser and Android) moves between screens instead of leaving the game.
let curView = null;
window.addEventListener('popstate', (e) => { if (me) show((e.state && e.state.v) || 'lobby', true); });
function show(v, fromHistory) {
  if (!fromHistory && v !== curView && me && v !== 'auth') {
    try { (curView && curView !== 'auth' ? history.pushState : history.replaceState).call(history, { v }, ''); } catch { /* sandboxed embed */ }
  }
  curView = v;
  document.querySelectorAll('.view').forEach((el) => (el.hidden = el.id !== 'v-' + v));
  document.querySelectorAll('.side [data-go], .tabbar [data-go]').forEach((a) => a.classList.toggle('active', a.dataset.go === v));
  const signedIn = v !== 'auth' && !!me;
  $('#side').hidden = !signedIn; $('#tabbar').hidden = !signedIn;
  if (v !== 'table' && table) { tryEmit('table:leave', { tableId: table.id }); table = null; }
  if (v !== 'tour') tour = null;
  if (v === 'tournaments') loadTours();
  if (v === 'earn') renderEarn();
  if (v === 'lobby' && me) $('#hello').textContent = `Welcome back, ${me.name}`;
  if (v === 'admin') loadAdmin();
  if (window.RB21Games) window.RB21Games.onShow(v);
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g && me) { e.preventDefault(); show(g.dataset.go); } });

// ---------- auth ----------
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  authMode = b.dataset.mode;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.reg').forEach((x) => (x.hidden = authMode !== 'register'));
  $('#authSubmit').textContent = authMode === 'register' ? 'Create account' : 'Sign in';
});
$('#authForm').onsubmit = async (e) => {
  e.preventDefault(); $('#authErr').textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  try { const r = await api('/api/auth/' + authMode, f); token = r.token; safeStorage.setItem('rb21_token', token); start(r.user); }
  catch (err) { $('#authErr').textContent = err.message; }
};
function logout() {
  if (offline) { offline = false; safeStorage.removeItem('rb21_mode'); if (socket) socket.disconnect(); socket = null; me = null; $('#nav').hidden = true; return boot(); }
  safeStorage.removeItem('rb21_token'); token = null; me = null; if (socket) socket.disconnect(); $('#nav').hidden = true; show('auth');
}
async function goOffline() {
  offline = true; safeStorage.setItem('rb21_mode', 'offline');
  cfg = await local().api('/api/config');
  start(await local().api('/api/me'));
}
$('#btnOffline').onclick = () => goOffline().catch((e) => toast(e.message));
$('#btnLogout').onclick = logout;

function setMe(u) {
  me = { ...me, ...u };
  $('#credits').textContent = fmt(me.credits);
  $('#btnAdmin').hidden = !me.admin;
  const now = Date.now();
  $('#btnDaily').disabled = now < me.nextDaily;
  $('#refillCard').hidden = (me.credits + (me.escrow || 0)) >= cfg.economy.refillThreshold;
  $('#adCard').hidden = !adsAvailable();
  if (!$('#v-earn').hidden) renderEarn();
}
const adsAvailable = () => !offline && !!((isApp && AdMob && cfg.admobRewardedId) || (!isApp && cfg.adsenseClient) || cfg.simulateAds);
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : `${m}:${String(x).padStart(2, '0')}`; };
let earnTick = null;
function renderEarn() {
  clearInterval(earnTick);
  const draw = () => {
    if (!me || $('#v-earn').hidden) return clearInterval(earnTick);
    const now = Date.now(), e = cfg.economy;
    const left = e.adDailyCap - (me.adsToday || 0);
    $('#btnAd').textContent = `+${fmt(e.adReward)}`;
    $('#btnAd').disabled = now < me.nextAd || left <= 0;
    $('#adStatus').textContent = left <= 0 ? 'Daily limit reached. Come back tomorrow.' : now < me.nextAd ? `Next video in ${clock(me.nextAd - now)} · ${left} left today` : `Earn ${fmt(e.adReward)} credits per video · ${left} left today`;
    $('#btnDaily').textContent = `+${fmt(e.dailyBonus)}`;
    $('#btnDaily').disabled = now < me.nextDaily;
    $('#dailyStatus').textContent = now < me.nextDaily ? `Ready in ${clock(me.nextDaily - now)}` : 'Ready to claim!';
    $('#btnRefill').textContent = `+${fmt(e.refillAmount)}`;
  };
  draw(); earnTick = setInterval(draw, 1000);
}
async function start(user) {
  $('#nav').hidden = false; setMe(user);
  if (socket) socket.disconnect();
  if (offline) socket = local().socket();
  else { await loadSocketIO(); socket = io(API || undefined, { auth: { token } }); }
  document.body.classList.toggle('is-offline', offline);
  $('#btnLogout').textContent = offline ? 'Go online' : 'Sign out';
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') logout(); });
  socket.on('disconnect', (r) => { if (r === 'io server disconnect') logout(); });
  socket.on('wallet', (w) => setMe(w));
  socket.on('notice', (n) => showGifts([n], false));
  socket.on('tables', renderTableList);
  socket.on('table', (t) => { if (table && t.id === table.id) { table = t; renderTable(); } });
  socket.on('tournaments:changed', () => { if (!$('#v-tournaments').hidden) loadTours(); });
  if (user.inbox && user.inbox.length) showGifts(user.inbox, true);
  if (AdMob && cfg.admobRewardedId) AdMob.initialize({}).catch(() => {});
  socket.on('connect', () => { if (table) tryEmit('table:watch', { tableId: table.id }); });
  show('lobby');
}
// ---------- PayPal ----------
let ppLoading = null;
function loadPayPal() {
  if (window.paypal) return Promise.resolve();
  if (!ppLoading) ppLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.paypalClientId)}&currency=USD&intent=capture&components=buttons&disable-funding=paylater,credit`;
    s.onload = res; s.onerror = () => { ppLoading = null; rej(new Error('PayPal could not load. Check your connection or ad blocker.')); };
    document.head.appendChild(s);
  });
  return ppLoading;
}
async function payWithPayPal(sel, payload, onDone) {
  const box = $(sel);
  box.innerHTML = '<p class="sub">Loading PayPal…</p>';
  try { await loadPayPal(); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  box.innerHTML = '';
  window.paypal.Buttons({
    style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay' },
    createOrder: async () => {
      try { return (await api('/api/paypal/orders', payload)).id; } catch (e) { toast(e.message); throw e; }
    },
    onApprove: async (data) => {
      box.innerHTML = '<p class="sub">Confirming payment…</p>';
      try { const r = await api(`/api/paypal/orders/${encodeURIComponent(data.orderID)}/capture`, {}); setMe(r.user); onDone(r); }
      catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    },
    onCancel: () => toast('Payment cancelled'),
    onError: () => toast('PayPal could not finish the payment. You were not charged.'),
  }).render(sel);
}
function loadSocketIO() {
  if (window.io) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = API + '/socket.io/socket.io.js'; s.onload = res; s.onerror = () => rej(new Error('Game server unreachable')); document.head.appendChild(s); });
}

// ---------- lobby ----------
function renderTableList(list) {
  $('#tableList').innerHTML = list.map((t) => `<button class="tbl" data-t="${esc(t.id)}"><strong>${esc(t.name)}</strong><span>Bets ${fmt(t.min)}–${fmt(t.max)} · ${t.players}/${t.seats} seated</span></button>`).join('');
  $('#tableList').querySelectorAll('[data-t]').forEach((b) => b.onclick = () => openTable(b.dataset.t));
}
async function loadTours() {
  try {
    const list = await api('/api/tournaments');
    $('#tourList').innerHTML = list.length ? list.map(tourRow).join('') : '<p class="empty">No tournaments right now. Check back soon.</p>';
    $('#tourList').querySelectorAll('[data-join]').forEach((b) => b.onclick = () => enterTour(list.find((t) => t.id === b.dataset.join)));
    $('#tourList').querySelectorAll('[data-play]').forEach((b) => b.onclick = () => openTour(b.dataset.play));
  } catch (e) { toast(e.message); }
}
const isReal = (t) => t.prizeType === 'cash' || t.prizeType === 'item';
function prizeText(t) {
  if (!isReal(t)) return `${fmt(t.prizePool)} credit pool`;
  return t.prizes.map((p) => `${['1st', '2nd', '3rd'][p.place - 1]}: ${esc(p.description)}`).join(' · ');
}
function entryLabel(t) { return t.entryType === 'paid' ? 'Enter for ' + money(t.entryPriceCents) : t.entryType === 'credits' ? 'Enter for ' + fmt(t.entryFee) + ' credits' : 'Enter free'; }
async function enterTour(t) {
  if (isApp && t.entryType === 'paid') return toast('Paid entries are available on the website version.');
  const join = async (extra) => {
    try {
      await api(`/api/tournaments/${t.id}/join`, extra || {}); $('#dlg').open && $('#dlg').close(); toast('You’re in. Good luck.'); openTour(t.id);
    } catch (e) { toast(e.message); }
  };
  if (!isReal(t) && t.entryType !== 'paid') return join();
  const body = isReal(t)
    ? `<h3>${esc(t.name)}</h3><p class="sub">No purchase necessary. Buying credits never helps you here: everyone starts with ${fmt(t.startingStack)} chips.</p>
       <p><b>Prizes</b><br>${t.prizes.map((p) => `${['1st', '2nd', '3rd'][p.place - 1]}: ${esc(p.description)}${p.valueCents ? ' (approx. ' + money(p.valueCents) + ')' : ''}`).join('<br>')}</p>
       <p><b>Official rules</b></p><div class="rules">${esc(t.rules)}</div>`
    : `<h3>${esc(t.name)}</h3><p class="sub">Entry costs ${money(t.entryPriceCents)}. Prizes are play credits (${fmt(t.prizePool)} pool) with no cash value; they can’t be withdrawn or exchanged for money or goods. Refunded automatically if the tournament is cancelled or full.</p>`;
  openDialog(body + `<label class="check"><input type="checkbox" id="elig"> ${isReal(t) ? 'I’m 18 or older, eligible where I live, and I accept the official rules.' : 'I’m 18 or older and understand the prize is play credits only.'}</label>
    ${t.entryType === 'paid' ? '<div id="ppButtons" class="pp"></div>' : `<p><button class="brass wide" id="doJoin" disabled>${entryLabel(t)}</button></p>`}`);
  if (t.entryType === 'paid') {
    if (!cfg.storeEnabled) { $('#ppButtons').innerHTML = '<p class="err">Paid entry isn’t available yet.</p>'; return; }
    $('#elig').onchange = (e) => {
      if (!e.target.checked) { $('#ppButtons').innerHTML = ''; return; }
      payWithPayPal('#ppButtons', { kind: 'tournament', tournamentId: t.id, confirmTerms: true }, (r) => {
        $('#dlg').close(); toast(r.message); if (r.message.includes('entered')) openTour(t.id); else loadTours();
      });
    };
    return;
  }
  $('#elig').onchange = (e) => ($('#doJoin').disabled = !e.target.checked);
  $('#doJoin').onclick = () => join({ confirmEligible: true });
}
function tourRow(t) {
  const open = t.status === 'open';
  const action = !open ? `<button class="ghost" data-play="${t.id}">Results</button>`
    : t.me ? `<button class="brass" data-play="${t.id}">${t.me.finished ? 'Standings' : 'Play'}</button>`
    : `<button class="brass" data-join="${t.id}">${entryLabel(t)}</button>`;
  return `<div class="tour"><div><strong>${esc(t.name)}</strong> <span class="prize">${prizeText(t)}</span>
    <div class="meta">${open ? 'Ends ' + new Date(t.endsAt).toLocaleString() : 'Finished'} · ${t.entrants} entered · ${t.hands} hands · ${fmt(t.startingStack)} chips</div></div>${action}</div>`;
}

// ---------- cards ----------
function cardHTML(c) {
  if (c.hidden) return '<div class="card back" aria-label="face-down card"></div>';
  const red = c.s === 'H' || c.s === 'D';
  return `<div class="card${red ? ' red' : ''}" aria-label="${c.r} of ${c.s}"><div class="c-r">${c.r}</div><div class="c-s">${SUIT[c.s]}</div><div class="c-big">${SUIT[c.s]}</div></div>`;
}
const handTotal = (h) => (h.total > 21 ? 'Bust ' + h.total : (h.soft && h.total < 21 ? 'Soft ' : '') + h.total);

// ---------- multiplayer table ----------
async function openTable(id) {
  try { table = await emit('table:watch', { tableId: id }); show('table'); table = table || null; renderTable(); }
  catch (e) { toast(e.message); }
}
let tick = null;
function renderTable() {
  const t = table; if (!t) return;
  // show() clears table when switching views; restore after.
  $('#tName').textContent = `${t.name} · ${fmt(t.min)}–${fmt(t.max)}`;
  const r = t.round, mySeat = t.seats.findIndex((s) => s && s.uid === me.id);
  $('#dealerHand').innerHTML = r ? r.dealer.cards.map(cardHTML).join('') : '';
  $('#dealerTotal').textContent = r ? 'Dealer ' + r.dealer.total : '';
  const cur = r && r.turn >= 0 ? r.hands[r.turn] : null;
  $('#seats').innerHTML = t.seats.map((s, i) => {
    const hands = r ? r.hands.filter((h) => h.seat === i) : [];
    const cls = ['seat', s && s.uid === me.id ? 'mine' : '', cur && cur.seat === i ? 'turn' : ''].join(' ');
    const handsHTML = hands.length ? `<div class="sub-hands">${hands.map((h) => `<div class="hwrap${h === cur ? ' active' : ''}"><div class="hand">${h.cards.map(cardHTML).join('')}</div><div>${handTotal(h)} · <span class="chipstack">${fmt(h.bet)}</span></div>${h.result ? `<div class="res ${h.result}">${RESULT[h.result]}${h.payout ? ' +' + fmt(h.payout) : ''}</div>` : ''}</div>`).join('')}</div>` : '';
    const spot = s ? (s.bet ? `<span class="chipstack">${fmt(s.bet)}</span>` : '') : (mySeat === -1 ? `<button class="ghost sm" data-sit="${i}">Sit</button>` : 'Open');
    return `<div class="${cls}">${handsHTML}<div class="spot">${spot}</div><div class="nm">${s ? esc(s.name) + (s.uid === me.id ? ' (you)' : '') : ''}</div></div>`;
  }).join('');
  $('#seats').querySelectorAll('[data-sit]').forEach((b) => b.onclick = () => tryEmit('table:sit', { tableId: t.id, seat: +b.dataset.sit }));

  const c = $('#controls');
  if (mySeat === -1) c.innerHTML = '<p class="sub">Pick an open seat to play, or just watch.</p>';
  else if (t.phase === 'betting') {
    const chips = [10, 50, 100, 500, 1000].filter((v) => v <= t.max);
    c.innerHTML = chips.map((v) => `<button class="chip" data-v="${v}" aria-label="Bet ${v}">${v >= 1000 ? '1K' : v}</button>`).join('') +
      `<button class="ghost act" id="clr">Clear</button><button class="ghost act" id="stand-up">Leave seat</button>`;
    c.querySelectorAll('.chip').forEach((b) => b.onclick = () => tryEmit('table:bet', { tableId: t.id, amount: +b.dataset.v }));
    $('#clr').onclick = () => tryEmit('table:clear', { tableId: t.id });
    $('#stand-up').onclick = () => tryEmit('table:leave', { tableId: t.id });
  } else if (t.phase === 'playing' && cur && cur.owner === me.id) {
    c.innerHTML = r.allowed.map((a) => `<button class="${a === 'hit' || a === 'stand' ? 'brass' : 'ghost'} act" data-a="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('');
    c.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => tryEmit('table:act', { tableId: t.id, action: b.dataset.a }));
  } else c.innerHTML = '';

  const offset = Date.now() - t.now;
  clearInterval(tick);
  const status = () => {
    const now = Date.now() - offset;
    let s = '';
    if (t.phase === 'betting') s = t.countdownEnd ? `Dealing in ${Math.max(0, Math.ceil((t.countdownEnd - now) / 1000))}s` : `Place bets (min ${fmt(t.min)})`;
    else if (t.phase === 'playing') s = cur ? `${cur.owner === me.id ? 'Your move' : esc(t.seats[cur.seat]?.name || 'Player') + '’s move'} · ${Math.max(0, Math.ceil((t.turnEnd - now) / 1000))}s` : '';
    else s = 'Paying out';
    $('#tStatus').textContent = s;
  };
  status(); tick = setInterval(status, 500);
}

// ---------- tournaments ----------
async function openTour(id) {
  const list = await api('/api/tournaments');
  tour = list.find((t) => t.id === id);
  if (!tour) return toast('Tournament not found');
  show('tour'); tour = list.find((t) => t.id === id);
  tourBet = tour.minBet; renderTour();
}
function renderTour() {
  const t = tour, r = t.round, open = t.status === 'open';
  $('#trName').textContent = t.name;
  $('#trStatus').textContent = t.me ? `Chips ${fmt(t.me.stack)} · Hand ${Math.min(t.me.handsPlayed + (r && r.phase === 'playing' ? 1 : 0), t.hands)}/${t.hands}` : open ? 'Not entered' : 'Finished';
  $('#trDealer').innerHTML = r ? r.dealer.cards.map(cardHTML).join('') : '';
  $('#trDealerTotal').textContent = r ? 'Dealer ' + r.dealer.total : '';
  $('#trHands').innerHTML = r ? r.hands.map((h, i) => `<div class="hwrap${i === r.turn ? ' active' : ''}"><div class="hand">${h.cards.map(cardHTML).join('')}</div><div class="total">${handTotal(h)} · <span class="chipstack">${fmt(h.bet)}</span></div>${h.result ? `<div class="res ${h.result}">${RESULT[h.result]}</div>` : ''}</div>`).join('') : '';
  const c = $('#trControls');
  const playing = r && r.phase === 'playing';
  if (!open || !t.me) c.innerHTML = '';
  else if (playing) {
    c.innerHTML = r.allowed.map((a) => `<button class="${a === 'hit' || a === 'stand' ? 'brass' : 'ghost'} act" data-a="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('');
    c.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => emit('tour:act', { id: t.id, action: b.dataset.a }).then(applyTour).catch((e) => toast(e.message)));
  } else if (t.me.finished) c.innerHTML = '<p class="sub">You’ve played your hands. Final standings post when the clock runs out.</p>';
  else {
    const max = Math.min(t.maxBet, t.me.stack);
    tourBet = Math.min(Math.max(tourBet, t.minBet), max);
    c.innerHTML = `<label style="min-width:240px">Bet <b id="tbv">${fmt(tourBet)}</b><input id="tbr" type="range" min="${t.minBet}" max="${max}" step="${t.minBet}" value="${tourBet}"></label><button class="brass act" id="tdeal">Deal</button>`;
    $('#tbr').oninput = (e) => { tourBet = +e.target.value; $('#tbv').textContent = fmt(tourBet); };
    $('#tdeal').onclick = () => emit('tour:deal', { id: t.id, bet: tourBet }).then(applyTour).catch((e) => toast(e.message));
  }
  const rows = (t.status === 'finished' ? t.winners.map((w) => ({ ...w, label: ['1st', '2nd', '3rd'][w.place - 1] })) : t.standings.map((s, i) => ({ ...s, label: i + 1 })));
  $('#trBoard').innerHTML = `<h3>${t.status === 'finished' ? 'Winners' : 'Standings'}</h3><p class="sub">${prizeText(t)}${open ? ' · ends ' + new Date(t.endsAt).toLocaleString() : ''}</p>
    <table><tr><th>#</th><th>Player</th><th>Chips</th><th>${t.status === 'finished' ? 'Prize' : 'Hands'}</th></tr>
    ${rows.map((s) => `<tr><td>${s.label}</td><td>${esc(s.name)}${s.uid === me.id ? ' (you)' : ''}</td><td>${fmt(s.stack)}</td><td>${t.status === 'finished' ? (s.prizeCredits ? fmt(s.prizeCredits) + ' credits' : s.prize ? esc(s.prize) : '—') : s.handsPlayed + '/' + t.hands}</td></tr>`).join('') || '<tr><td colspan="4">No entries yet</td></tr>'}</table>`;
}
function applyTour(d) { tour = { ...d.t, round: d.round }; renderTour(); }

// ---------- monetization ----------
$('#btnDaily').onclick = () => api('/api/bonus/daily', {}).then((u) => { setMe(u); toast(`+${cfg.economy.dailyBonus} credits`); }).catch((e) => toast(e.message));
$('#btnRefill').onclick = () => api('/api/bonus/refill', {}).then((u) => { setMe(u); toast(`+${cfg.economy.refillAmount} credits`); }).catch((e) => toast(e.message));
const claimAd = () => api('/api/ads/reward', {}).then((u) => { setMe(u); toast(`+${cfg.economy.adReward} credits`); }).catch((e) => toast(e.message));
$('#btnAd').onclick = async () => {
  if (Date.now() < me.nextAd) return toast('Next video ready in ' + clock(me.nextAd - Date.now()));
  if (isApp && AdMob && cfg.admobRewardedId) {
    try {
      $('#btnAd').disabled = true;
      await AdMob.prepareRewardVideoAd({ adId: cfg.admobRewardedId });
      const reward = await AdMob.showRewardVideoAd();
      if (reward) claimAd(); else toast('Watch to the end to earn credits');
    } catch (e) { toast('No video available right now. Try again soon.'); }
    finally { renderEarn(); }
  } else if (cfg.adsenseClient && window.adBreak) {
    window.adBreak({ type: 'reward', name: 'bonus_credits',
      beforeReward: (showAdFn) => showAdFn(), adViewed: claimAd, adDismissed: () => toast('Watch to the end to earn credits'),
      adBreakDone: (info) => { if (info.breakStatus !== 'viewed' && info.breakStatus !== 'dismissed') toast('No ad available right now. Try later.'); } });
  } else if (cfg.simulateAds) {
    let n = 10;
    openDialog(`<h3>Sponsored</h3><p class="sub">Test ad (SIMULATE_ADS=true). Credits in <b id="adN">${n}</b>s.</p><div style="height:160px;border:1px dashed var(--line);border-radius:10px;display:grid;place-items:center">Ad placeholder</div>`);
    const iv = setInterval(() => { n--; const el = $('#adN'); if (el) el.textContent = n; if (n <= 0) { clearInterval(iv); $('#dlg').close(); claimAd(); } }, 1000);
    $('#dlg').addEventListener('close', () => clearInterval(iv), { once: true });
  }
};
function showGifts(list, fromInbox) {
  const total = list.reduce((s, n) => s + n.amount, 0);
  openDialog(`<div class="notice"><p class="eyebrow">You got a gift</p><p class="big">+${fmt(total)}</p>
    ${list.map((n) => n.message ? `<p>“${esc(n.message)}”</p>` : '').join('')}<p class="sub">Credits from the Riverboat team</p></div>`);
  if (fromInbox) api('/api/inbox/clear', {}).catch(() => {});
  else api('/api/inbox/clear', {}).catch(() => {});
}
function giftDialog(target) {
  const everyone = !target;
  openDialog(`<h3>${everyone ? 'Gift every player' : 'Give credits to ' + esc(target.name)}</h3>
    ${everyone ? '' : `<p class="sub">${esc(target.email)} · has ${fmt(target.credits)} credits</p>`}
    <label>Amount<input id="gAmt" type="number" value="1000" step="1"></label>
    <div class="gift-amts">${[100, 500, 1000, 5000, 10000, 50000].map((v) => `<button class="ghost sm" data-a="${v}">${fmt(v)}</button>`).join('')}</div>
    ${everyone ? '' : '<p class="fine">Use a negative number to take credits away.</p>'}
    <label>Message they’ll see (optional)<input id="gMsg" maxlength="140" placeholder="Thanks for playing!"></label>
    <button class="cta wide" id="gSend">${everyone ? 'Send to everyone' : 'Send credits'}</button>`);
  document.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => ($('#gAmt').value = b.dataset.a));
  $('#gSend').onclick = async () => {
    const amount = parseInt($('#gAmt').value, 10), message = $('#gMsg').value;
    if (!amount) return toast('Enter an amount');
    if (everyone && !confirm(`Send ${fmt(amount)} credits to every player?`)) return;
    try {
      const r = everyone ? await api('/api/admin/credits/everyone', { amount, message }) : await api(`/api/admin/users/${target.id}/credits`, { amount, message });
      $('#dlg').close(); toast(everyone ? `Sent to ${fmt(r.players)} players` : `Sent ${fmt(amount)} credits`); loadAdmin();
    } catch (e) { toast(e.message); }
  };
}
function openDialog(html) { $('#dlgBody').innerHTML = html + '<p style="text-align:right"><button class="ghost" id="dlgClose">Close</button></p>'; $('#dlgClose').onclick = () => $('#dlg').close(); $('#dlg').showModal(); }
$('#btnStore').onclick = () => {
  if (!cfg.storeEnabled) return openDialog(`<h3>Get credits</h3><p class="sub">The credit store isn’t open yet. Grab your daily bonus${cfg.adsenseClient || cfg.simulateAds ? ' or watch an ad' : ''} for free credits.</p>`);
  openDialog(`<h3>Get credits</h3><p class="sub">Play credits only. No cash value, can’t be withdrawn, and never used to enter real-prize tournaments.</p>
    <div class="packs">${cfg.packs.map((p) => `<button class="pack" data-p="${p.id}"><b>${fmt(p.credits)}</b>${esc(p.label)}<br>$${(p.priceCents / 100).toFixed(2)}</button>`).join('')}</div>
    <div id="ppButtons" class="pp"></div>`);
  document.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b));
    payWithPayPal('#ppButtons', { kind: 'pack', packId: b.dataset.p }, (r) => { $('#dlg').close(); toast(r.message || 'Credits added'); });
  });
};
function loadAdsense() {
  if (!cfg.adsenseClient) return;
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.adsenseClient);
  if (cfg.adsTestMode) s.dataset.adbreakTest = 'on';
  document.head.appendChild(s);
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = (o) => window.adsbygoogle.push(o);
  window.adConfig({ preloadAdBreaks: 'on' });
  if (cfg.adsenseBannerSlot) {
    const b = $('#adBanner'); b.hidden = false;
    b.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%;max-width:728px;height:90px" data-ad-client="${esc(cfg.adsenseClient)}" data-ad-slot="${esc(cfg.adsenseBannerSlot)}"></ins>`;
    window.adsbygoogle.push({});
  }
}

// ---------- admin ----------
const tf = $('#tourForm');
const RULES_TEMPLATE = `NO PURCHASE NECESSARY. Buying credits does not improve your chances.
Eligibility: open to legal residents of the United States who are 18 or older. Void where prohibited.
How to win: every entrant starts with the same chip stack and number of hands. The 3 highest stacks when the tournament ends win. Ties go to whoever used fewer hands.
Prizes: listed above. Winners are contacted by email within 7 days and must reply within 14 days or an alternate winner is chosen. Winners are responsible for any taxes.
Sponsor: [your name / Dashlith], [contact email].`;
function syncTourForm() {
  const real = tf.prizeType.value !== 'credits';
  if (real) tf.entryType.value = 'free';
  tf.entryType.querySelectorAll('option').forEach((o) => (o.disabled = real && o.value !== 'free'));
  document.querySelectorAll('.f-real').forEach((x) => (x.hidden = !real));
  document.querySelectorAll('.f-credits').forEach((x) => (x.hidden = real));
  document.querySelector('.f-fee').hidden = tf.entryType.value !== 'credits';
  document.querySelector('.f-price').hidden = tf.entryType.value !== 'paid';
  if (real && !tf.rules.value) tf.rules.value = RULES_TEMPLATE;
}
tf.prizeType.onchange = syncTourForm; tf.entryType.onchange = syncTourForm; syncTourForm();
tf.onsubmit = async (e) => {
  e.preventDefault(); $('#tourErr').textContent = '';
  const f = Object.fromEntries(new FormData(tf));
  f.endsAt = new Date(f.endsAt).toISOString();
  f.prizes = [1, 2, 3].map((i) => ({ description: f['p' + i + 'd'], value: f['p' + i + 'v'] })).filter((p) => p.description);
  try { await api('/api/admin/tournaments', f); toast('Tournament created'); tf.name.value = ''; loadAdmin(); }
  catch (err) { $('#tourErr').textContent = err.message; }
};
let q = '';
$('#userQ').oninput = (e) => { q = e.target.value; clearTimeout(loadUsers.t); loadUsers.t = setTimeout(loadUsers, 250); };
async function loadUsers() {
  const users = await api('/api/admin/users?q=' + encodeURIComponent(q));
  $('#userList').innerHTML = users.map((u) => `<div class="li"><div>${esc(u.name)} <small>${esc(u.email)}</small><br><small>${fmt(u.credits)} credits${u.banned ? ' · suspended' : ''}</small></div>
    <div><button class="ghost sm" data-g="${u.id}">Give credits</button> ${u.id === me.id ? "" : `<button class="ghost sm" data-b="${u.id}" data-v="${u.banned ? 0 : 1}">${u.banned ? 'Unsuspend' : 'Suspend'}</button>`}</div></div>`).join('') || '<p class="empty">No players found</p>';
  $('#userList').querySelectorAll('[data-g]').forEach((b) => b.onclick = () => giftDialog(users.find((u) => u.id === b.dataset.g)));
  $('#userList').querySelectorAll('[data-b]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/admin/users/${b.dataset.b}/ban`, { banned: b.dataset.v === '1' }); loadUsers(); } catch (e) { toast(e.message); }
  });
}
async function loadAdmin() {
  if (!me?.admin) return show('lobby');
  api('/api/admin/grants').then((gs) => {
    $('#grantList').innerHTML = gs.map((g) => `<div class="li"><span>${esc(g.email)}</span><small>${g.amount > 0 ? '+' : ''}${fmt(g.amount)}${g.message ? ' · “' + esc(g.message) + '”' : ''} · ${new Date(g.at).toLocaleDateString()}</small></div>`).join('') || '<p class="empty">No gifts yet</p>';
  }).catch(() => {});
  $('#adsHint').hidden = !!(cfg.adsenseClient || cfg.admobRewardedId || cfg.simulateAds);
  const d = new Date(Date.now() + 24 * 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  if (!tf.endsAt.value) tf.endsAt.value = d.toISOString().slice(0, 16);
  try {
    await loadUsers();
    const tl = await api('/api/tournaments');
    $('#adminTours').innerHTML = tl.map((t) => `<div class="li"><div>${esc(t.name)} <small>${t.status} · ${t.entrants} entered${t.revenueCents ? ' · ' + money(t.revenueCents) + ' in entries' : ''}</small>
      ${t.status === 'finished' && isReal(t) ? t.winners.map((w) => `<br><small>${w.place}. ${esc(w.name)} &lt;${esc(w.email)}&gt; — ${esc(w.prize)}</small>
        <select data-prize="${t.id}" data-place="${w.place}">${['pending', 'contacted', 'sent'].map((st) => `<option ${st === w.prizeStatus ? 'selected' : ''}>${st}</option>`).join('')}</select>`).join('') : ''}</div>
      ${t.status === 'open' ? `<div><button class="ghost sm" data-fin="${t.id}">End now</button> <button class="ghost sm" data-can="${t.id}">Cancel</button></div>` : ''}</div>`).join('') || '<p class="empty">None yet</p>';
    $('#adminTours').querySelectorAll('[data-fin]').forEach((b) => b.onclick = () => confirm('End this tournament and pay out?') && api(`/api/admin/tournaments/${b.dataset.fin}/finish`, {}).then(loadAdmin).catch((e) => toast(e.message)));
    $('#adminTours').querySelectorAll('[data-can]').forEach((b) => b.onclick = () => confirm('Cancel and refund entry fees?') && api(`/api/admin/tournaments/${b.dataset.can}/cancel`, {}).then(loadAdmin).catch((e) => toast(e.message)));
    $('#adminTours').querySelectorAll('[data-prize]').forEach((sel) => sel.onchange = () => api(`/api/admin/tournaments/${sel.dataset.prize}/prize`, { place: +sel.dataset.place, status: sel.value }).then(() => toast('Prize status saved')).catch((e) => toast(e.message)));
    const pays = await api('/api/admin/payments');
    $('#payList').innerHTML = pays.map((p) => `<div class="li"><span>${esc(p.email)}</span><small>${p.kind === 'tournament' ? 'Entry: ' + esc(p.tournament || '') : fmt(p.credits) + ' credits'} · ${money(p.amount || 0)}${p.refunded ? ' · refunded' : ''} · ${new Date(p.at).toLocaleDateString()}</small></div>`).join('') || '<p class="empty">No purchases yet</p>';
  } catch (e) { toast(e.message); }
}
$('#btnAdmin').onclick = () => show('admin');
$('#btnGiftAll').onclick = () => giftDialog(null);

window.RB21 = { api, toast, fmt, esc, cardHTML, show, setMe: (u) => setMe(u), get me() { return me; } };

// ---------- embedded (e.g. Google Sites) ----------
let framed = false;
try { framed = window.self !== window.top; } catch { framed = true; }
if (framed) {
  const a = document.createElement('a');
  a.href = location.href.split('#')[0]; a.target = '_blank'; a.rel = 'noopener'; a.className = 'popout';
  a.textContent = 'Open full screen ↗';
  document.querySelector('.bar').appendChild(a);
  document.body.classList.add('framed');
}

// ---------- boot ----------
async function boot() {
  document.body.classList.toggle('is-offline', offline);
  if (offline) return goOffline();
  $('#authNote').textContent = '';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 75000);
    $('#authNote').textContent = 'Connecting to the game server…';
    cfg = await fetch(API + '/api/config', { signal: ctl.signal }).then((r) => { if (!r.ok) throw new Error(); return r.json(); });
    clearTimeout(t);
    if (offline) return; // player chose offline while we were connecting
    $('#authNote').textContent = '';
  } catch {
    if (offline) return;
    show('auth');
    $('#authNote').textContent = 'Can’t reach the online server right now (no internet, or it’s waking up). You can play offline, or refresh in a minute.';
    return;
  }
  loadAdsense();
  if (token) { try { start(await api('/api/me')); return; } catch {} }
  show('auth');
}
try { if (!isApp && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* sandboxed embed: no install/offline cache, game still works */ }
boot();
})();
