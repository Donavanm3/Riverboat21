'use strict';
// Dice, Mines, Plinko and Crash screens. All outcomes come from the server (or the offline engine).
(() => {
const R = window.RB21;
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let info = null;
const getInfo = async () => (info = info || await R.api('/api/games/info'));
const credits = (n) => R.setMe({ credits: n });
const betOf = (id) => { const v = Math.floor(Number($('#' + id).value)); return Number.isFinite(v) ? v : 0; };
const pushHist = (el, txt, win, max = 12) => { el.insertAdjacentHTML('afterbegin', `<span class="${win ? 'w' : 'l'}">${txt}</span>`); while (el.children.length > max) el.lastChild.remove(); };
document.addEventListener('click', (e) => {
  const h = e.target.closest('[data-half],[data-double]'); if (!h) return;
  const inp = $('#' + (h.dataset.half || h.dataset.double)); const v = Number(inp.value) || 1;
  inp.value = Math.max(1, h.dataset.half ? Math.floor(v / 2) : v * 2); inp.dispatchEvent(new Event('input'));
});
function seg(el, onChange) {
  el.querySelectorAll('button').forEach((b) => b.onclick = () => { el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onChange(b.dataset.v); });
  return () => el.querySelector('.on').dataset.v;
}

// ================= Dice =================
const dc = { busy: false };
let dcMode;
function dcCalc() {
  const t = Number($('#dcTarget').value), over = dcMode() === 'over';
  const chance = over ? 100 - t : t;
  const mult = Math.floor((99 / chance) * 10000) / 10000;
  $('#dcChance').textContent = chance + '%'; $('#dcMult').textContent = mult.toFixed(2) + '×';
  $('#dcWin').textContent = R.fmt(Math.floor(betOf('dcBet') * mult));
  const f = $('#dcFill'); if (over) { f.style.left = t + '%'; f.style.right = '0'; } else { f.style.left = '0'; f.style.right = (100 - t) + '%'; }
  return { chance, over };
}
async function dcRoll() {
  if (dc.busy) return; dc.busy = true; $('#dcRoll').disabled = true;
  try {
    const { chance, over } = dcCalc();
    const res = await R.api('/api/games/dice', { bet: betOf('dcBet'), chance, over });
    const el = $('#dcResult'); el.className = 'dice-result';
    const mark = $('#dcMark'); mark.hidden = false;
    for (let i = 0; i < 8; i++) { el.textContent = (Math.random() * 100).toFixed(2); await sleep(35); }
    el.textContent = res.roll.toFixed(2); el.classList.add(res.win ? 'w' : 'l');
    mark.style.left = res.roll + '%'; mark.textContent = Math.round(res.roll);
    pushHist($('#dcHist'), res.roll.toFixed(2), res.win);
    credits(res.credits);
    if (res.win) R.toast(`Won ${R.fmt(res.payout)}`);
  } catch (e) { R.toast(e.message); } finally { dc.busy = false; $('#dcRoll').disabled = false; }
}

// ================= Mines =================
const mn = { active: false, revealed: [], busy: false, bet: 0 };
function mnGrid(bombs = null, hit = null) {
  const g = $('#mnGrid');
  g.innerHTML = [...Array(25).keys()].map((i) => {
    let cls = 'tile', txt = '';
    if (mn.revealed.includes(i)) { cls += ' gem'; txt = '◆'; }
    else if (bombs) { if (bombs.includes(i)) { cls += i === hit ? ' bomb' : ' ghost-bomb'; txt = '✹'; } else { cls += ' ghost-gem'; txt = '◆'; } }
    return `<button class="${cls}" data-c="${i}" ${mn.active && !mn.revealed.includes(i) ? '' : 'disabled'} aria-label="Tile ${i + 1}">${txt}</button>`;
  }).join('');
  g.querySelectorAll('.tile').forEach((b) => b.onclick = () => mnReveal(+b.dataset.c));
}
function mnStats(mult, next) {
  $('#mnMult').textContent = (mult || 1).toFixed(2) + '×';
  $('#mnNext').textContent = next ? next.toFixed(2) + '×' : '–';
  const pay = mn.active && mn.revealed.length ? Math.floor(mn.bet * mult) : 0;
  $('#mnPay').textContent = pay ? R.fmt(pay) : '–';
  $('#mnGo').textContent = mn.active ? (mn.revealed.length ? `Cash out ${R.fmt(pay)}` : 'Pick a tile…') : 'Start';
  $('#mnGo').disabled = mn.active && !mn.revealed.length;
  $('#mnBet').disabled = $('#mnCount').disabled = mn.active;
}
async function mnGo() {
  if (mn.busy) return; mn.busy = true;
  try {
    if (!mn.active) {
      const r = await R.api('/api/games/mines/start', { bet: betOf('mnBet'), mines: Number($('#mnCount').value) });
      Object.assign(mn, { active: true, revealed: [], bet: r.bet });
      credits(r.credits); mnGrid(); mnStats(1, r.next); $('#mnMsg').textContent = 'Pick tiles. Cash out whenever you like.';
    } else {
      const r = await R.api('/api/games/mines/cashout', {});
      mn.active = false; credits(r.credits); mnGrid(r.bombs); mnStats(r.mult, null);
      $('#mnMsg').innerHTML = `Cashed out <b>${R.fmt(r.payout)}</b> at ${r.mult.toFixed(2)}×`;
    }
  } catch (e) { R.toast(e.message); } finally { mn.busy = false; }
}
async function mnReveal(cell) {
  if (mn.busy || !mn.active) return; mn.busy = true;
  try {
    const r = await R.api('/api/games/mines/reveal', { cell });
    mn.revealed = r.revealed;
    if (r.bomb) {
      mn.active = false; credits(r.credits); mnGrid(r.bombs, cell); mnStats(1, null);
      $('#mnMsg').innerHTML = 'Boom! You hit a mine.';
    } else if (r.done) {
      mn.active = false; credits(r.credits); mnGrid(r.bombs); mnStats(r.mult, null);
      $('#mnMsg').innerHTML = `Cleared the board! Won <b>${R.fmt(r.payout)}</b>`;
    } else { mnGrid(); mnStats(r.mult, r.next); $('#mnMsg').textContent = `${r.mult.toFixed(2)}× · keep going or cash out`; }
  } catch (e) { R.toast(e.message); } finally { mn.busy = false; }
}

// ================= Plinko =================
const pl = { balls: [], raf: 0, seq: 0, applied: 0 };
const PW = 640, PH = 560, ROWS = 12, TOP = 40, ROWH = (PH - 90) / ROWS, SP = PW / 15, CX = PW / 2;
function plColor(i, n) { const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2); const hue = 50 - d * 50; return `hsl(${hue} 95% ${60 - d * 8}%)`; }
function plSlots() {
  const m = info.plinko[plRisk()];
  $('#plSlots').innerHTML = m.map((x, i) => `<span style="background:${plColor(i, m.length)}">${x}×</span>`).join('');
}
function plPos(path, f) { // f = progress in rows (0..ROWS+0.6)
  const k = Math.min(Math.floor(f), ROWS), t = f - k;
  const rights = (n) => path.slice(0, n).reduce((a, b) => a + b, 0);
  const xAt = (n) => CX + SP * (rights(n) - n / 2);
  const yAt = (n) => TOP + n * ROWH - 10;
  if (k >= ROWS) return { x: xAt(ROWS), y: yAt(ROWS) + t * 40 };
  const x = xAt(k) + (xAt(k + 1) - xAt(k)) * t;
  const y = yAt(k) + (yAt(k + 1) - yAt(k)) * t - Math.sin(t * Math.PI) * 12;
  return { x, y };
}
function plDraw() {
  const c = $('#plCanvas'), g = c.getContext('2d');
  g.clearRect(0, 0, PW, PH);
  g.fillStyle = '#c9d3ee';
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < r + 3; i++) {
    const x = CX + SP * (i - (r + 2) / 2), y = TOP + r * ROWH + ROWH / 2;
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }
  const now = performance.now();
  pl.balls = pl.balls.filter((b) => {
    const f = (now - b.t0) / 170;
    const p = plPos(b.path, Math.min(f, ROWS + 0.6));
    g.fillStyle = '#ff4f9a'; g.shadowColor = '#ff4f9a'; g.shadowBlur = 12;
    g.beginPath(); g.arc(p.x, p.y, 8, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    if (f >= ROWS + 0.6) { plLanded(b); return false; }
    return true;
  });
  pl.raf = pl.balls.length ? requestAnimationFrame(plDraw) : 0;
}
function plLanded(b) {
  const s = $('#plSlots').children[b.res.slot];
  if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
  if (b.seq > pl.applied) { pl.applied = b.seq; credits(b.res.credits); }
  $('#plMsg').innerHTML = `${b.res.mult}× · ${b.res.payout >= b.res.stake ? 'won' : 'returned'} <b>${R.fmt(b.res.payout)}</b>`;
}
let plRisk;
async function plDrop() {
  try {
    const res = await R.api('/api/games/plinko', { bet: betOf('plBet'), risk: plRisk() });
    pl.balls.push({ path: res.path, res, t0: performance.now(), seq: ++pl.seq });
    if (!pl.raf) pl.raf = requestAnimationFrame(plDraw);
  } catch (e) { R.toast(e.message); }
}

// ================= Crash =================
const cr = { st: null, offset: 0, raf: 0, poll: 0, busy: false };
const CW = 720, CH = 420;
const crMultAt = (ms) => Math.floor(100 * Math.exp(Math.max(0, ms) / info.crash.rate)) / 100;
function crDraw(mult, elapsed, state) {
  const c = $('#crCanvas'), g = c.getContext('2d');
  g.clearRect(0, 0, CW, CH);
  const maxT = Math.max(8000, elapsed * 1.15), maxM = Math.max(2, mult * 1.2);
  const X = (t) => 40 + (t / maxT) * (CW - 60), Y = (m) => CH - 30 - ((m - 1) / (maxM - 1)) * (CH - 60);
  g.strokeStyle = '#ffffff12'; g.lineWidth = 1; g.fillStyle = '#8c98b5'; g.font = '12px Plus Jakarta Sans, sans-serif';
  for (let i = 1; i <= 4; i++) { const m = 1 + ((maxM - 1) * i) / 4; g.beginPath(); g.moveTo(40, Y(m)); g.lineTo(CW - 20, Y(m)); g.stroke(); g.fillText(m.toFixed(1) + '×', 4, Y(m) + 4); }
  if (!elapsed) return;
  const color = state === 'crashed' ? '#ff5470' : state === 'cashed' ? '#2ee6a6' : '#a58bff';
  const grad = g.createLinearGradient(0, 0, 0, CH); grad.addColorStop(0, color + '66'); grad.addColorStop(1, color + '00');
  g.beginPath(); g.moveTo(X(0), Y(1));
  const steps = 80; for (let i = 1; i <= steps; i++) { const t = (elapsed * i) / steps; g.lineTo(X(t), Y(crMultAt(t))); }
  g.lineTo(X(elapsed), CH - 30); g.lineTo(X(0), CH - 30); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); g.moveTo(X(0), Y(1)); for (let i = 1; i <= steps; i++) { const t = (elapsed * i) / steps; g.lineTo(X(t), Y(crMultAt(t))); }
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(X(elapsed), Y(mult), 7, 0, Math.PI * 2); g.fill();
}
function crButton() {
  const running = cr.st && cr.st.phase === 'running';
  $('#crGo').textContent = running ? 'Cash out' : 'Start';
  $('#crGo').classList.toggle('alt', running);
  $('#crBet').disabled = $('#crAuto').disabled = running;
}
function crFrame() {
  if (!cr.st || cr.st.phase !== 'running') return;
  const elapsed = Date.now() - cr.offset - cr.st.startedAt;
  const m = crMultAt(elapsed);
  $('#crMult').textContent = m.toFixed(2) + '×'; $('#crMult').className = 'crash-mult';
  $('#crGo').textContent = `Cash out ${R.fmt(Math.floor(cr.st.bet * m))}`;
  crDraw(m, elapsed, 'running');
  cr.raf = requestAnimationFrame(crFrame);
}
function crFinish(v) {
  cancelAnimationFrame(cr.raf); clearInterval(cr.poll);
  cr.st = v; credits(v.credits);
  const end = v.phase === 'cashed' ? v.cashedAt : v.crash;
  const elapsed = Math.log(Math.max(1, end)) * info.crash.rate;
  crDraw(end, Math.max(elapsed, 1), v.phase);
  const el = $('#crMult'); el.className = 'crash-mult ' + v.phase;
  el.textContent = v.phase === 'cashed' ? `${v.cashedAt.toFixed(2)}×` : `Crashed ${v.crash.toFixed(2)}×`;
  $('#crMsg').innerHTML = v.phase === 'cashed' ? `Cashed out <b>${R.fmt(v.payout)}</b> · it crashed at ${v.crash.toFixed(2)}×` : `Crashed at ${v.crash.toFixed(2)}×`;
  pushHist($('#crHist'), v.crash.toFixed(2) + '×', v.phase === 'cashed');
  crButton();
}
function crRun(v) {
  cr.st = v; cr.offset = Date.now() - v.now; crButton();
  if (v.phase !== 'running') return crFinish(v);
  $('#crMsg').textContent = v.auto ? `Auto cash out at ${v.auto.toFixed(2)}×` : 'Cash out before it crashes!';
  cancelAnimationFrame(cr.raf); cr.raf = requestAnimationFrame(crFrame);
  clearInterval(cr.poll);
  cr.poll = setInterval(async () => {
    try { const s = await R.api('/api/games/crash'); if (s.phase !== 'running') crFinish(s); } catch { /* keep animating */ }
  }, 400);
}
async function crGo() {
  if (cr.busy) return; cr.busy = true;
  try {
    if (cr.st && cr.st.phase === 'running') crFinish(await R.api('/api/games/crash/cashout', {}));
    else {
      const auto = $('#crAuto').value.trim();
      const v = await R.api('/api/games/crash/start', { bet: betOf('crBet'), auto: auto ? Number(auto) : null });
      credits(v.credits); crRun(v);
    }
  } catch (e) { R.toast(e.message); } finally { cr.busy = false; }
}

// ================= wiring =================
let wired = false;
function wire() {
  if (wired) return; wired = true;
  dcMode = seg($('#dcMode'), dcCalc);
  $('#dcTarget').oninput = dcCalc; $('#dcBet').oninput = dcCalc; $('#dcRoll').onclick = dcRoll;
  $('#mnGo').onclick = mnGo;
  plRisk = seg($('#plRisk'), plSlots); $('#plDrop').onclick = plDrop;
  $('#crGo').onclick = crGo;
}
const prev = window.RB21Games.onShow;
window.RB21Games.onShow = async (v) => {
  await prev(v);
  if (!['dice', 'mines', 'plinko', 'crash'].includes(v)) {
    if (cr.poll) { clearInterval(cr.poll); cancelAnimationFrame(cr.raf); cr.poll = 0; }
    return;
  }
  try { await getInfo(); } catch (e) { return R.toast(e.message); }
  wire();
  if (v === 'dice') dcCalc();
  if (v === 'mines') {
    const s = await R.api('/api/games/mines').catch(() => ({ active: false }));
    Object.assign(mn, { active: !!s.active, revealed: s.revealed || [], bet: s.bet || 0 });
    mnGrid(); mnStats(s.mult || 1, s.active ? s.next : null);
  }
  if (v === 'plinko') { plSlots(); plDraw(); }
  if (v === 'crash') {
    crDraw(1, 0, 'idle');
    const s = await R.api('/api/games/crash').catch(() => ({ phase: 'idle' }));
    if (s.phase === 'running') crRun(s); else crButton();
  }
};
})();
