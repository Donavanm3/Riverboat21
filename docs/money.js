'use strict';
// "Earn real money" screens (player + admin). Website only; hidden in the mobile apps and offline mode.
(() => {
const R = window.RB21;
const $ = (s) => document.querySelector(s);
const usd = (c) => '$' + ((c || 0) / 100).toFixed(2);
const day = (t) => (t ? new Date(t).toLocaleDateString() : '');
const KIND = { referral: 'Referral', contest: 'Contest prize', bounty: 'Bug bounty', job: 'Paid job', tournament: 'Tournament prize', award: 'Award' };
const OPP = { contest: 'Contest', bounty: 'Bug bounty', job: 'Paid job' };

// ---------------- player ----------------
async function load() {
  let v;
  try { v = await R.api('/api/money'); } catch (e) { return R.toast(e.message); }
  $('#mnyJoin').hidden = v.joined; $('#mnyMain').hidden = !v.joined;
  document.querySelectorAll('.mnyHold').forEach((el) => (el.textContent = v.holdDays));
  $('#mnyRateTxt').textContent = `Earn ${v.percent}% of what people you invite spend on credit packs and paid entries during their first ${v.windowDays} days.`;
  if (!v.joined) return;
  $('#mnyAvail').textContent = usd(v.balances.availableCents); $('#mnyPend').textContent = usd(v.balances.pendingCents);
  $('#mnyReq').textContent = usd(v.balances.requestedCents); $('#mnyPaid').textContent = usd(v.balances.paidCents);
  $('#mnyLink').value = v.link; $('#mnyCode').textContent = v.code; $('#mnyRefs').textContent = v.referrals === 1 ? '1 person' : `${v.referrals} people`;
  $('#mnyRefTxt').textContent = `Earn ${v.percent}% of purchases from people who join with your link, for ${v.windowDays} days after they sign up. Earnings unlock after a ${v.holdDays}-day refund hold.`;
  $('#mnyCreator').innerHTML = v.creatorCodes.length ? `<p class="fine">Creator code${v.creatorCodes.length > 1 ? 's' : ''}: ${v.creatorCodes.map((c) => `<b>${R.esc(c.code)}</b> (${c.percent}%)`).join(', ')}. Fans enter it when signing up.</p>` : '';
  $('#mnyMinTxt').textContent = `Minimum payout ${usd(v.minPayoutCents)}. Payouts are sent by PayPal, usually within a week.`;
  if (!$('#mnyEmail').value) $('#mnyEmail').value = v.paypalEmail;
  $('#mnyPayout').disabled = v.balances.availableCents < v.minPayoutCents || v.balances.requestedCents > 0;
  $('#mnyPayout').textContent = v.balances.requestedCents > 0 ? 'Payout on its way' : `Request ${usd(v.balances.availableCents)}`;
  $('#mnyW9').textContent = v.w9 ? 'Tax form on file.' : 'Before your first payout we’ll email you a W-9 tax form to fill in (required by US law).';
  $('#mnyLedger').innerHTML = v.ledger.map((e) => `<div class="li"><span>${KIND[e.kind] || e.kind}<small> · ${R.esc(e.note)}</small></span><small><b>${usd(e.cents)}</b> · ${e.status === 'pending' ? 'unlocks ' + day(e.availableAt) : e.status} · ${day(e.at)}</small></div>`).join('')
    + v.payouts.map((p) => `<div class="li"><span>Payout${p.note ? '<small> · ' + R.esc(p.note) + '</small>' : ''}</span><small><b>${usd(p.cents)}</b> · ${p.status} · ${day(p.settledAt || p.at)}</small></div>`).join('')
    || '<p class="empty">Nothing yet. Share your link or enter a contest below.</p>';
  loadOpps();
}
async function loadOpps() {
  let v; try { v = await R.api('/api/opportunities'); } catch (e) { return R.toast(e.message); }
  $('#mnyOpps').innerHTML = v.open.map((o) => `<div class="opp">
      <div class="opp-top"><span class="pill k-${o.kind}">${OPP[o.kind]}</span><b>${R.esc(o.reward)}</b>${o.endsAt ? `<small>Ends ${new Date(o.endsAt).toLocaleString()}</small>` : ''}</div>
      <h3>${R.esc(o.title)}</h3><p>${R.esc(o.description)}</p>
      ${o.rules ? `<details><summary>Official rules</summary><div class="rules">${R.esc(o.rules)}</div></details>` : ''}
      <button class="ghost sm" data-enter="${o.id}">${o.kind === 'job' ? 'Apply' : o.kind === 'bounty' ? 'Report a bug' : 'Enter (free)'}</button></div>`).join('')
    || '<p class="empty">Nothing open right now. Check back soon.</p>';
  $('#mnyOpps').querySelectorAll('[data-enter]').forEach((b) => b.onclick = () => enter(v.open.find((o) => o.id === b.dataset.enter)));
  $('#mnyMine').innerHTML = v.mine.map((s) => `<div class="li"><span>${R.esc(s.title)}</span><small>${s.status === 'awarded' ? '<b>Awarded ' + usd(s.awardCents) + '</b>' : s.status} · ${day(s.at)}</small></div>`).join('') || '<p class="empty">No entries yet.</p>';
}
function enter(o) {
  R.openDialog(`<h3>${R.esc(o.title)}</h3><p class="sub">${R.esc(o.reward)}</p>
    <label>Link (https://…) to your work, video, or screenshots<input id="enLink" placeholder="https://"></label>
    <label>${o.kind === 'job' ? 'Why you’d be great, and how to reach you' : o.kind === 'bounty' ? 'What happened, and the steps to make it happen again' : 'Anything we should know'}<textarea id="enMsg" rows="4"></textarea></label>
    <label class="check"><input type="checkbox" id="enAdult"> I’m 18+ and this is my own work${o.rules ? ', and I accept the official rules' : ''}.</label>
    <button class="cta wide" id="enGo">Send</button>`);
  $('#enGo').onclick = async () => {
    try { await R.api(`/api/opportunities/${o.id}/submit`, { link: $('#enLink').value, message: $('#enMsg').value, adult: $('#enAdult').checked }); $('#dlg').close(); R.toast('Sent! We’ll review it soon.'); loadOpps(); }
    catch (e) { R.toast(e.message); }
  };
}
function wirePlayer() {
  $('#mnyJoinBtn').onclick = async () => {
    try { await R.api('/api/money/join', { adult: $('#mnyAdult').checked, accept: $('#mnyAccept').checked }); R.toast('Welcome to the program!'); load(); }
    catch (e) { R.toast(e.message); }
  };
  $('#mnyCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#mnyLink').value); R.toast('Link copied'); } catch { $('#mnyLink').select(); R.toast('Select and copy the link'); } };
  $('#mnyShare').onclick = async () => {
    const text = `Play free blackjack, slots and more on Riverboat 21 (I get a reward if you buy credits): ${$('#mnyLink').value}`;
    if (navigator.share) { try { await navigator.share({ title: 'Riverboat 21', text }); } catch { /* cancelled */ } }
    else { try { await navigator.clipboard.writeText(text); R.toast('Share message copied'); } catch { R.toast(text); } }
  };
  $('#mnyPayout').onclick = async () => {
    try { await R.api('/api/money/payout', { paypalEmail: $('#mnyEmail').value }); R.toast('Payout requested'); load(); } catch (e) { R.toast(e.message); }
  };
}

// ---------------- admin ----------------
let A = null;
async function loadAdmin() {
  try { A = await R.api('/api/admin/money'); } catch (e) { return; }
  const s = A.settings;
  $('#maPct').value = s.referralPercent; $('#maWin').value = s.windowDays; $('#maHold').value = s.holdDays; $('#maMin').value = s.minPayoutCents / 100;
  $('#maTotals').textContent = `Owed: ${usd((A.totals.available || 0) + (A.totals.requested || 0))} · On hold: ${usd(A.totals.pending || 0)} · Paid: ${usd(A.totals.paid || 0)}`;
  $('#maPayouts').innerHTML = A.payouts.map((p) => `<div class="li"><div><b>${usd(p.cents)}</b> to ${R.esc(p.paypalEmail)}<br><small>${R.esc(p.name)} · ${R.esc(p.email)} · paid this year ${usd(p.paidThisYearCents)}</small></div>
      <div class="li-actions"><label class="check sm"><input type="checkbox" data-w9="${p.uid}" ${p.w9 ? 'checked' : ''}> W-9 received</label>
      <button class="cta sm" data-paid="${p.id}">Mark paid</button><button class="ghost sm" data-rej="${p.id}">Reject</button></div></div>`).join('') || '<p class="empty">No payout requests.</p>';
  $('#maSubs').innerHTML = A.submissions.map((x) => `<div class="li"><div><b>${R.esc(x.title)}</b> · ${R.esc(x.name)} <small>${R.esc(x.email)}</small><br>
      ${x.link ? `<a href="${R.esc(x.link)}" target="_blank" rel="noopener noreferrer">${R.esc(x.link)}</a><br>` : ''}<small>${R.esc(x.message)}</small></div>
      <div class="li-actions"><input type="number" min="1" step="1" placeholder="$" data-amt="${x.id}" style="width:80px"><button class="cta sm" data-award="${x.id}">Award</button><button class="ghost sm" data-decl="${x.id}">Decline</button></div></div>`).join('') || '<p class="empty">Nothing to review.</p>';
  $('#maEarn').innerHTML = A.recentEarnings.map((e) => `<div class="li"><span>${KIND[e.kind] || e.kind} · ${R.esc(e.name || '')}<small> · ${R.esc(e.note)}</small></span>
      <small><b>${usd(e.cents)}</b> · ${e.status} ${['pending', 'available'].includes(e.status) ? `<button class="ghost sm" data-void="${e.id}">Void</button>` : ''}</small></div>`).join('') || '<p class="empty">No earnings yet.</p>';
  $('#maPaid').innerHTML = A.recentPayouts.map((p) => `<div class="li"><span>${usd(p.cents)} · ${R.esc(p.name)}<small> · ${R.esc(p.paypalEmail)}</small></span><small>${p.status}${p.note ? ' · ' + R.esc(p.note) : ''} · ${day(p.settledAt)}</small></div>`).join('') || '<p class="empty">None yet.</p>';
  $('#maCodes').innerHTML = A.codes.map((c) => `<div class="li"><span><b>${R.esc(c.code)}</b> · ${R.esc(c.name)} <small>${c.percent}%</small></span><button class="ghost sm" data-delcode="${R.esc(c.code)}">Remove</button></div>`).join('') || '<p class="empty">No creator codes.</p>';
  $('#maOpps').innerHTML = A.opps.map((o) => `<div class="li"><span>${OPP[o.kind]} · <b>${R.esc(o.title)}</b><small> · ${o.entries} entries · ${o.open ? 'open' : 'closed'}</small></span>${o.open ? `<button class="ghost sm" data-close="${o.id}">Close</button>` : ''}</div>`).join('');
  const act = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
  const run = async (fn, ok) => { try { await fn(); if (ok) R.toast(ok); loadAdmin(); } catch (e) { R.toast(e.message); } };
  document.querySelectorAll('[data-w9]').forEach((c) => (c.onchange = () => run(() => R.api(`/api/admin/money/w9/${c.dataset.w9}`, { onFile: c.checked }), 'Saved')));
  act('[data-paid]', (b) => { const note = prompt('Send the money in PayPal first. Add a note (e.g. PayPal transaction ID):', ''); if (note !== null) run(() => R.api(`/api/admin/money/payouts/${b.dataset.paid}/paid`, { note }), 'Marked paid'); });
  act('[data-rej]', (b) => { const note = prompt('Reason (the player sees this):', ''); if (note !== null) run(() => R.api(`/api/admin/money/payouts/${b.dataset.rej}/reject`, { note }), 'Rejected, balance returned'); });
  act('[data-award]', (b) => { const d = Number(document.querySelector(`[data-amt="${b.dataset.award}"]`).value); if (!d) return R.toast('Enter an amount'); if (confirm(`Award $${d.toFixed(2)}?`)) run(() => R.api(`/api/admin/money/submissions/${b.dataset.award}/award`, { dollars: d }), 'Awarded'); });
  act('[data-decl]', (b) => run(() => R.api(`/api/admin/money/submissions/${b.dataset.decl}/decline`, {}), 'Declined'));
  act('[data-void]', (b) => { const reason = prompt('Why void this earning?', 'Suspected abuse'); if (reason !== null) run(() => R.api(`/api/admin/money/earnings/${b.dataset.void}/void`, { reason }), 'Voided'); });
  act('[data-delcode]', (b) => { if (confirm('Remove this creator code? Past referrals keep the default rate.')) run(() => R.api(`/api/admin/money/codes/${b.dataset.delcode}/delete`, {}), 'Removed'); });
  act('[data-close]', (b) => run(() => R.api(`/api/admin/money/opps/${b.dataset.close}/close`, {}), 'Closed'));
}
function wireAdmin() {
  $('#maSaveSet').onclick = async () => {
    try { await R.api('/api/admin/money/settings', { referralPercent: $('#maPct').value, windowDays: $('#maWin').value, holdDays: $('#maHold').value, minPayoutCents: Math.round(Number($('#maMin').value) * 100) }); R.toast('Program settings saved'); loadAdmin(); }
    catch (e) { R.toast(e.message); }
  };
  $('#maAddCode').onclick = async () => {
    try { await R.api('/api/admin/money/codes', { email: $('#maCodeEmail').value, code: $('#maCode').value, percent: $('#maCodePct').value }); R.toast('Creator code saved'); $('#maCode').value = ''; loadAdmin(); }
    catch (e) { R.toast(e.message); }
  };
  $('#maKind').onchange = () => {
    if ($('#maKind').value === 'contest' && !$('#maRules').value) $('#maRules').value = 'NO PURCHASE NECESSARY. Free to enter. Open to people 18 or older where permitted; void where prohibited.\nHow to enter: submit a link to your original work before the end date. Up to 3 entries per person.\nJudging: chosen by the Riverboat 21 team on creativity and quality. Decisions are final.\nPrize: as listed, paid by PayPal after a W-9 is received. Winners are responsible for taxes.\nSponsor: [your name], [contact email].';
  };
  $('#maPost').onclick = async () => {
    const ends = $('#maEnds').value ? new Date($('#maEnds').value).toISOString() : '';
    try {
      await R.api('/api/admin/money/opps', { kind: $('#maKind').value, title: $('#maTitle').value, reward: $('#maReward').value, description: $('#maDesc').value, rules: $('#maRules').value, endsAt: ends });
      ['#maTitle', '#maReward', '#maDesc', '#maRules', '#maEnds'].forEach((s) => ($(s).value = '')); $('#maKind').onchange(); R.toast('Posted'); loadAdmin();
    } catch (e) { R.toast(e.message); }
  };
  $('#maKind').onchange();
}

let wired = false;
const prev = window.RB21Games.onShow;
window.RB21Games.onShow = async (v) => {
  await prev(v);
  if (v !== 'money' && v !== 'admin') return;
  if (!wired) { wired = true; wirePlayer(); wireAdmin(); }
  if (v === 'money') load();
  if (v === 'admin' && R.me && R.me.admin) loadAdmin();
};
})();
