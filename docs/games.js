'use strict';
// Roulette, Slots, Video Poker and Baccarat screens. All outcomes come from the server.
(() => {
const R = window.RB21;
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHIP_VALUES = [1, 5, 25, 100, 500, 1000];
let info = null, busy = false;
const getInfo = async () => (info = info || await R.api('/api/games/info'));
function chipBar(el, state) {
  el.innerHTML = CHIP_VALUES.map((v) => `<button class="chip${state.chip === v ? ' sel' : ''}" data-v="${v}" aria-label="Chip ${v}">${v >= 1000 ? '1K' : v}</button>`).join('');
  el.querySelectorAll('.chip').forEach((b) => b.onclick = () => { state.chip = +b.dataset.v; chipBar(el, state); });
}
const lock = async (btns, fn) => {
  if (busy) return; busy = true; btns.forEach((b) => (b.disabled = true));
  try { await fn(); } catch (e) { R.toast(e.message); } finally { busy = false; btns.forEach((b) => (b.disabled = false)); }
};
const credits = (n) => R.setMe({ credits: n });

// ================= Roulette =================
const rl = { chip: 5, bets: {}, last: {}, hist: [], red: new Set() };
const RL_OUT = [['low', '1–18'], ['even', 'Even'], ['red', 'Red'], ['black', 'Black'], ['odd', 'Odd'], ['high', '19–36']];
function rlCell(key, label, cls = '', style = '') {
  const amt = rl.bets[key];
  return `<button class="rc ${cls}" data-k="${key}" style="${style}">${label}${amt ? `<i class="bchip">${R.fmt(amt)}</i>` : ''}</button>`;
}
function rlRender() {
  let h = rlCell('n:0', '0', 'green', 'grid-row:1/4;grid-column:1');
  for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) {
    const n = col * 3 + (3 - row);
    h += rlCell('n:' + n, n, rl.red.has(n) ? 'red' : 'black', `grid-row:${row + 1};grid-column:${col + 2}`);
  }
  ['col3', 'col2', 'col1'].forEach((c, i) => (h += rlCell(c, '2:1', 'out', `grid-row:${i + 1};grid-column:14`)));
  ['dozen1', 'dozen2', 'dozen3'].forEach((d, i) => (h += rlCell(d, ['1st 12', '2nd 12', '3rd 12'][i], 'out', `grid-row:4;grid-column:${2 + i * 4}/span 4`)));
  RL_OUT.forEach(([k, l], i) => (h += rlCell(k, l, 'out' + (k === 'red' ? ' red' : k === 'black' ? ' black' : ''), `grid-row:5;grid-column:${2 + i * 2}/span 2`)));
  $('#rlBoard').innerHTML = h;
  $('#rlBoard').querySelectorAll('.rc').forEach((b) => b.onclick = () => {
    if (busy) return;
    rl.bets[b.dataset.k] = (rl.bets[b.dataset.k] || 0) + rl.chip; rlRender();
  });
  $('#rlTotal').textContent = R.fmt(Object.values(rl.bets).reduce((a, b) => a + b, 0));
  $('#rlHist').innerHTML = rl.hist.map((n) => `<span class="${n === 0 ? 'green' : rl.red.has(n) ? 'red' : 'black'}">${n}</span>`).join('');
}
const rlBets = () => Object.entries(rl.bets).map(([k, amount]) => (k.startsWith('n:') ? { type: 'straight', value: +k.slice(2), amount } : { type: k, amount }));
async function rlSpin() {
  if (!Object.keys(rl.bets).length) return R.toast('Place a bet on the board first');
  await lock([$('#rlSpin'), $('#rlClear'), $('#rlRebet')], async () => {
    const res = await R.api('/api/games/roulette', { bets: rlBets() });
    const ball = $('#rlBall'); ball.className = 'rl-ball spin'; $('#rlMsg').textContent = 'No more bets…';
    for (let i = 0; i < 16; i++) { const n = Math.floor(Math.random() * 37); ball.textContent = n; ball.className = 'rl-ball spin ' + (n === 0 ? 'green' : rl.red.has(n) ? 'red' : 'black'); await sleep(40 + i * 8); }
    ball.textContent = res.number; ball.className = 'rl-ball ' + res.color;
    rl.hist = [res.number, ...rl.hist].slice(0, 14); rl.last = { ...rl.bets }; rl.bets = {};
    const net = res.payout - res.stake;
    $('#rlMsg').innerHTML = `${res.number} ${res.color}. ${res.payout ? `You win <b>${R.fmt(res.payout)}</b>` : 'No win'}${res.payout ? ` (${net >= 0 ? '+' : ''}${R.fmt(net)})` : ''}`;
    credits(res.credits); rlRender();
  });
}

// ================= Slots =================
const SYM = { cherry: '🍒', lemon: '🍋', bell: '🔔', bar: 'BAR', seven: '7', diamond: '💎' };
const sl = { bet: 25, steps: [5, 10, 25, 50, 100, 250, 500, 1000, 2500], grid: [['seven', 'bell', 'cherry'], ['diamond', 'seven', 'bar'], ['lemon', 'cherry', 'seven']] };
function slRender(win = []) {
  const hot = new Set();
  win.forEach((w) => info.slots.lines[w.line].forEach(([r, c]) => hot.add(r + ':' + c)));
  $('#slGrid').innerHTML = sl.grid.map((row, r) => row.map((s, c) => `<div class="sc s-${s}${hot.has(r + ':' + c) ? ' hot' : ''}">${SYM[s]}</div>`).join('')).join('');
  $('#slBet').textContent = R.fmt(sl.bet);
}
function slPaytable() {
  const lb = sl.bet / 5;
  $('#slPay').innerHTML = `<h3>Pays per line (line bet ${R.fmt(lb)})</h3><table>${info.slots.symbols.slice().reverse().map((s) => `<tr><td>${SYM[s.id]} ${SYM[s.id]} ${SYM[s.id]}</td><td>${s.three}×</td><td>${R.fmt(s.three * lb)}</td></tr>`).join('')}
    <tr><td>🍒 🍒 (first two)</td><td>${info.slots.cherryTwo}×</td><td>${R.fmt(info.slots.cherryTwo * lb)}</td></tr></table>
    <p class="fine">Returns about ${(info.slots.rtp * 100).toFixed(1)}% of credits played over the long run.</p>`;
}
function slStep(dir) { const i = Math.max(0, Math.min(sl.steps.length - 1, sl.steps.indexOf(sl.bet) + dir)); sl.bet = sl.steps[i]; slRender(); slPaytable(); }
async function slSpin() {
  await lock([$('#slSpin'), $('#slUp'), $('#slDown')], async () => {
    const res = await R.api('/api/games/slots', { bet: sl.bet });
    const keys = Object.keys(SYM);
    for (let col = 0; col < 3; col++) {
      for (let t = 0; t < 7 + col * 3; t++) {
        for (let r = 0; r < 3; r++) sl.grid[r][col] = keys[Math.floor(Math.random() * keys.length)];
        for (let c2 = col + 1; c2 < 3; c2++) for (let r = 0; r < 3; r++) sl.grid[r][c2] = keys[Math.floor(Math.random() * keys.length)];
        slRender(); await sleep(55);
      }
      for (let r = 0; r < 3; r++) sl.grid[r][col] = res.grid[r][col];
      slRender();
    }
    slRender(res.wins);
    $('#slMsg').innerHTML = res.payout ? `Win <b>${R.fmt(res.payout)}</b> on ${res.wins.length} line${res.wins.length > 1 ? 's' : ''}` : 'No win. Spin again?';
    credits(res.credits);
  });
}

// ================= Video poker =================
const vp = { bet: 10, steps: [1, 5, 10, 25, 50, 100, 250, 500, 1000], hand: null, holds: [false, false, false, false, false], pending: false, result: null };
function vpRender() {
  const h = vp.hand || [0, 1, 2, 3, 4].map(() => ({ hidden: true }));
  $('#vpHand').innerHTML = h.map((c, i) => `<button class="vp-card${vp.holds[i] ? ' held' : ''}" data-i="${i}" ${vp.pending ? '' : 'disabled'}>${R.cardHTML(c)}<span>${vp.holds[i] ? 'HELD' : vp.pending ? 'tap to hold' : ''}</span></button>`).join('');
  $('#vpHand').querySelectorAll('.vp-card').forEach((b) => b.onclick = () => { vp.holds[+b.dataset.i] = !vp.holds[+b.dataset.i]; vpRender(); });
  $('#vpGo').textContent = vp.pending ? 'Draw' : 'Deal';
  $('#vpBet').textContent = R.fmt(vp.bet);
  $('#vpUp').disabled = $('#vpDown').disabled = vp.pending;
  $('#vpPay').innerHTML = `<table>${info.poker.paytable.map(([k, n, m]) => `<tr class="${vp.result && vp.result.key === k ? 'hit' : ''}"><td>${n}</td><td>${m}×</td><td>${R.fmt(m * vp.bet)}</td></tr>`).join('')}</table>`;
}
async function vpGo() {
  await lock([$('#vpGo')], async () => {
    if (!vp.pending) {
      const res = await R.api('/api/games/poker/deal', { bet: vp.bet });
      Object.assign(vp, { hand: res.hand, holds: [false, false, false, false, false], pending: true, result: null });
      credits(res.credits);
      $('#vpMsg').textContent = res.preview.mult ? `You’re holding ${res.preview.name}. Pick cards to keep.` : 'Tap the cards you want to keep, then Draw.';
    } else {
      const res = await R.api('/api/games/poker/draw', { holds: vp.holds });
      Object.assign(vp, { hand: res.hand, pending: false, result: res.result });
      credits(res.credits);
      $('#vpMsg').innerHTML = res.payout ? `${res.result.name}! You win <b>${R.fmt(res.payout)}</b>` : 'No win. Deal again?';
    }
    vpRender();
  });
}

// ================= Baccarat =================
const bc = { chip: 25, bets: {} };
function bcRender() {
  for (const k of ['player', 'tie', 'banker']) $('#bcS-' + k).textContent = bc.bets[k] ? R.fmt(bc.bets[k]) : '';
}
async function bcDeal() {
  if (!Object.keys(bc.bets).length) return R.toast('Tap Player, Banker, or Tie to bet');
  await lock([$('#bcDeal'), $('#bcClear')], async () => {
    const res = await R.api('/api/games/baccarat', { bets: bc.bets });
    $('#bcP').innerHTML = ''; $('#bcB').innerHTML = ''; $('#bcPT').textContent = ''; $('#bcBT').textContent = '';
    const order = [['#bcP', res.player[0]], ['#bcB', res.banker[0]], ['#bcP', res.player[1]], ['#bcB', res.banker[1]]];
    if (res.player[2]) order.push(['#bcP', res.player[2]]);
    if (res.banker[2]) order.push(['#bcB', res.banker[2]]);
    for (const [sel, c] of order) { $(sel).insertAdjacentHTML('beforeend', R.cardHTML(c)); await sleep(350); }
    $('#bcPT').textContent = res.playerTotal; $('#bcBT').textContent = res.bankerTotal;
    const net = res.payout - res.stake;
    $('#bcMsg').innerHTML = `${res.winner === 'tie' ? 'Tie' : res.winner[0].toUpperCase() + res.winner.slice(1) + ' wins'}. ${res.payout ? `Paid <b>${R.fmt(res.payout)}</b> (${net >= 0 ? '+' : ''}${R.fmt(net)})` : 'No win.'}`;
    credits(res.credits); bc.bets = {}; bcRender();
  });
}

// ================= wiring =================
let wired = false;
function wire() {
  if (wired) return; wired = true;
  $('#rlSpin').onclick = rlSpin;
  $('#rlClear').onclick = () => { if (!busy) { rl.bets = {}; rlRender(); } };
  $('#rlRebet').onclick = () => { if (!busy && Object.keys(rl.last).length) { rl.bets = { ...rl.last }; rlRender(); } };
  $('#slSpin').onclick = slSpin; $('#slUp').onclick = () => slStep(1); $('#slDown').onclick = () => slStep(-1);
  $('#vpGo').onclick = vpGo;
  $('#vpUp').onclick = () => { vp.bet = vp.steps[Math.min(vp.steps.length - 1, vp.steps.indexOf(vp.bet) + 1)]; vpRender(); };
  $('#vpDown').onclick = () => { vp.bet = vp.steps[Math.max(0, vp.steps.indexOf(vp.bet) - 1)]; vpRender(); };
  document.querySelectorAll('.bc-spot').forEach((b) => b.onclick = () => { if (!busy) { bc.bets[b.dataset.s] = (bc.bets[b.dataset.s] || 0) + bc.chip; bcRender(); } });
  $('#bcDeal').onclick = bcDeal; $('#bcClear').onclick = () => { if (!busy) { bc.bets = {}; bcRender(); } };
}
window.RB21Games = {
  async onShow(v) {
    if (!['roulette', 'slots', 'poker', 'baccarat'].includes(v)) return;
    try { await getInfo(); } catch (e) { return R.toast(e.message); }
    wire();
    if (v === 'roulette') { rl.red = new Set(info.roulette.red); chipBar($('#rlChips'), rl); rlRender(); }
    if (v === 'slots') { slRender(); slPaytable(); }
    if (v === 'poker') {
      const p = await R.api('/api/games/poker').catch(() => ({ pending: false }));
      if (p.pending) { Object.assign(vp, { hand: p.hand, bet: p.bet, pending: true, result: null }); $('#vpMsg').textContent = 'You have a hand waiting. Pick holds and draw.'; }
      vpRender();
    }
    if (v === 'baccarat') { chipBar($('#bcChips'), bc); bcRender(); }
  },
};
})();
