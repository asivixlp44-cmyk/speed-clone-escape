import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import * as BX from './bloxity.js';
import { sfx, getVolumes, setVolume } from './audio.js';
import { QUALITIES, getQuality, setQuality } from './fx.js';
import { ICONS, fillIcons } from './icons.js';
import {
    CFG, STAGES, PRODUCTS, PASSES, QUESTS, FREE, xpFor, fmt, comma, clock, clamp,
} from '../../shared/config.js';

// Bux coin + amount (our own strings only; never user text)
const bux = (n) => '<i class="bx" aria-hidden="true"></i>' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }

const el = {
    wins: $('#winsVal'), steps: $('#stepsVal'), clones: $('#clonesVal'), maxClones: $('#maxClones'),
    xpFill: $('#xpFill'), levelTxt: $('#levelTxt'), xpTxt: $('#xpTxt'), boost: $('#boost'), freeBadge: $('#freeBadge'),
    quest: $('#quest'), questTxt: $('#questTxt'), prompt: $('#promptBtn'), promptTxt: $('#promptTxt'),
};
export const promptEl = el.prompt, promptTxtEl = el.promptTxt;
fillIcons();

// ----- HUD -----
const shown = { wins: null, steps: null };
function bump(node) { const s = node.closest('.bump-me'); if (!s) return; s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
// Wins and Steps count up smoothly to their new values
export function animateCounters(dt) {
    for (const key of ['wins', 'steps']) {
        const target = S[key];
        if (shown[key] === null) shown[key] = target;
        if (shown[key] === target) continue;
        if (target > shown[key] && key === 'wins') bump(el[key]);
        const diff = target - shown[key];
        shown[key] = Math.abs(diff) < 1 ? target : shown[key] + diff * Math.min(1, dt * 7);
        if (Math.abs(target - shown[key]) < Math.max(1, target * 0.002)) shown[key] = target;
        el[key].textContent = key === 'steps' ? comma(shown[key]) : fmt(shown[key]);
    }
}

const questValue = (stat) => (stat === 'level' ? S.level : stat === 'best' ? S.best : stat === 'rebirths' ? S.rebirths : S.totalWins) || 0;
export function updateHud(P, online, alive) {
    el.clones.textContent = alive + (alive === 1 ? ' Clone' : ' Clones');
    el.maxClones.textContent = 'MAX ' + (S.limit + (S.passes.PlusClones ? CFG.plusClones : 0)) + ' CLONES';
    const need = xpFor(S.level);
    el.xpFill.style.width = Math.min(100, S.xp / need * 100) + '%';
    el.levelTxt.textContent = 'Lvl ' + S.level;
    el.xpTxt.textContent = comma(S.xp) + '/' + comma(need);
    document.querySelectorAll('[data-pass]').forEach((n) => {
        const k = n.dataset.pass;
        setHtml(n.querySelector('.price'), S.passes[k] ? 'OWNED' : fmt(PASSES[k].price) + ' <i class="bx" aria-hidden="true"></i>');
        n.classList.toggle('owned', !!S.passes[k]);
    });
    document.querySelectorAll('[data-price]').forEach((n) => setHtml(n, bux(PRODUCTS[n.dataset.price].price)));
    setHtml($('#reviveYes'), bux(PRODUCTS.Revive.price) + ' Bux');
    const boostLeft = (S.boostUntil - net.now()) / 1000;
    el.boost.hidden = boostLeft <= 0;
    if (boostLeft > 0) el.boost.textContent = '👟 x' + CFG.boostMult + ' STEPS BOOST ' + clock(boostLeft);
    const mins = (net.now() - S.joinedAt) / 60000;
    el.freeBadge.hidden = !FREE.some((r, i) => mins >= r.min && !S.freeClaimed[i]);
    const q = QUESTS[S.quest];
    el.quest.hidden = !q;
    if (q) el.questTxt.textContent = q.text + ' (' + comma(Math.min(questValue(q.stat), q.n)) + '/' + comma(q.n) + ')';
    if (!$('#modal').hidden && modalKind === 'free') renderFree();
}

export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o'; d.textContent = text; d.style.color = color || '#fff';
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2400);
}
// "+8 👟" popups that float up around the middle of the screen while you run
// "-1 Clone" pops up red when a hazard or monster takes one
export function popLoss(left) {
    const box = $('#gains');
    const d = document.createElement('div');
    d.className = 'gain loss o';
    d.textContent = '-1 Clone' + (left === 0 ? '  ·  LAST ONE!' : '');
    d.style.left = (42 + Math.random() * 8) + '%';
    d.style.top = '46%';
    box.appendChild(d);
    setTimeout(() => d.remove(), 1100);
}
// Progress through the current stage, shown at the top of the screen
let barStage = -2;
export function updateStageBar(idx, z, boss) {
    const bar = $('#stageBar');
    if (idx < 0) { if (barStage !== -1) { bar.hidden = true; barStage = -1; } return; }
    const s = STAGES[idx];
    if (barStage !== idx) {
        barStage = idx;
        bar.hidden = false;
        $('#sbName').textContent = s.name + ' · ' + s.title;
        bar.dataset.theme = s.theme;
    }
    const pct = clamp((z - s.zS) / (s.cE + 18 - s.zS), 0, 1);
    $('#sbFill').style.width = (pct * 100).toFixed(1) + '%';
    $('#sbPct').textContent = Math.round(pct * 100) + '%';
    const b = $('#sbBoss');
    b.hidden = boss === null || boss === undefined;
    if (!b.hidden) b.style.left = (clamp((boss - s.zS) / (s.cE + 18 - s.zS), 0, 1) * 100).toFixed(1) + '%';
    bar.classList.toggle('danger', !b.hidden && z - boss < 30);
}
export function popGain(n, tread, gem) {
    const box = $('#gains');
    if (box.children.length > 10) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'gain o1' + (tread ? ' tread' : '') + (gem ? ' gem' : '');
    d.innerHTML = '+' + fmt(n) + '<i data-icon="shoeBlue">' + ICONS.shoeBlue + '</i>';
    d.style.left = (30 + Math.random() * 40) + '%';
    d.style.top = (38 + Math.random() * 26) + '%';
    box.appendChild(d);
    setTimeout(() => d.remove(), 1100);
}
// Big centred text: "+36 Clone Limit", "+1 Win!"
export function bigText(text, color) {
    const d = $('#bigText');
    d.textContent = text; d.style.color = color || '#fff';
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
// Dark strip above the quest: "You need 14 more wins to unlock this!"
let noticeTimer;
export function notice(text) {
    $('#noticeTxt').textContent = text;
    $('#notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 2600);
}
export function showWin(n) {
    const w = $('#winTop');
    w.textContent = '+' + fmt(n) + (n === 1 ? ' Win!' : ' Wins!');
    w.classList.remove('show'); void w.offsetWidth; w.classList.add('show');
    const f = $('#flash');
    f.classList.remove('show', 'gate', 'eat'); void f.offsetWidth; f.classList.add('show');
}
export function levelUp(to, clones) {
    const f = $('#flash');
    f.classList.remove('show', 'gate', 'eat'); void f.offsetWidth; f.classList.add('show');
    const d = $('#levelBanner');
    d.textContent = 'Lvl ' + to + (clones > 0 ? '  ·  +' + clones + (clones === 1 ? ' Clone!' : ' Clones!') : '  ·  MAX CLONES');
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
// Swallowed by a monster: the screen goes dark red
export function eatFlash() {
    const f = $('#flash');
    f.classList.remove('show', 'gate', 'eat'); void f.offsetWidth; f.classList.add('show', 'eat');
}
let titleTimer;
export function showStageTitle(name, title, sub) {
    $('#stageName').textContent = name;
    $('#stageTheme').textContent = title || '';
    $('#stageSub').textContent = sub || '';
    const t = $('#stageTitle'); t.style.opacity = 1;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 3000);
}
// First-visit how-to card; gameplay keeps running behind it
export function showTutorial(onDone) {
    const t = $('#tutorial');
    t.hidden = false;
    const done = () => { t.hidden = true; onDone(); };
    $('#tutPlay').onclick = done;
    setTimeout(() => { if (!t.hidden) done(); }, 15000);
}

// ----- purchases (free in the web demo; the server grants them) -----
let pendingBuy = null;
export function buy(kind, key) {
    if (kind === 'pass' && S.passes[key]) { toast(PASSES[key].name + ' already owned!', '#6fe0ff'); return; }
    const item = kind === 'pass' ? PASSES[key] : PRODUCTS[key];
    if (!item) return;
    if (net.bux) { buyBux(kind, key); return; }
    pendingBuy = { kind, key };
    $('#buyItem').textContent = item.name;
    setHtml($('#buyCost'), bux(item.price) + ' Bux');
    $('#buy').hidden = false;
}
// Bloxity shows its own confirm modal; the grant arrives from the server after its webhook
async function buyBux(kind, key) {
    const r = await BX.buyWithBux(kind, key);
    if (r.success) { toast('Purchase complete!', '#7dff6b'); return; }
    if (key === 'Revive') actions.revive(false);
    if (r.error && !/cancel/i.test(r.error)) toast(r.error, '#ff5a5a');
}
$('#buyOk').addEventListener('click', () => {
    $('#buy').hidden = true;
    if (pendingBuy) net.send('buy', pendingBuy);
    pendingBuy = null;
});
$('#buyCancel').addEventListener('click', () => {
    $('#buy').hidden = true;
    if (pendingBuy && pendingBuy.key === 'Revive') actions.revive(false);
    pendingBuy = null;
});
document.querySelectorAll('[data-pass]').forEach((b) => b.addEventListener('click', () => buy('pass', b.dataset.pass)));

// ----- revive popup -----
let reviveTimer;
export function showRevive() {
    $('#revive').hidden = false;
    let left = CFG.reviveTimeout;
    $('#reviveTimer').textContent = 'Returning to lobby in ' + left + 's';
    clearInterval(reviveTimer);
    reviveTimer = setInterval(() => {
        left--;
        $('#reviveTimer').textContent = 'Returning to lobby in ' + Math.max(0, left) + 's';
        if (left <= 0) { $('#buy').hidden = true; pendingBuy = null; actions.revive(false); }
    }, 1000);
}
export function hideRevive() {
    clearInterval(reviveTimer);
    $('#revive').hidden = true;
}
$('#reviveYes').addEventListener('click', () => { hideRevive(); buy('product', 'Revive'); });
$('#reviveNo').addEventListener('click', () => actions.revive(false));

// ----- panels -----
let modalKind = null;
export function openModal(kind) { modalKind = kind; renderModal(); $('#modal').hidden = false; }
export function closeModal() { $('#modal').hidden = true; modalKind = null; }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });
$('#btnRebirth').addEventListener('click', () => openModal('rebirth'));
$('#btnFree').addEventListener('click', () => openModal('free'));
$('#btnSettings').addEventListener('click', () => openModal('settings'));
// Every chunky button clicks
document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.btn')) sfx('click'); });

function renderSettings(body) {
    const vols = getVolumes();
    const w = document.createElement('div');
    w.className = 'settings';
    w.innerHTML = `
        <label class="set-row o1" for="volMusic"><span>🎵 Music</span><input id="volMusic" type="range" min="0" max="100" value="${Math.round(vols.music * 100)}"></label>
        <label class="set-row o1" for="volSfx"><span>🔊 Sound effects</span><input id="volSfx" type="range" min="0" max="100" value="${Math.round(vols.sfx * 100)}"></label>
        <div class="set-row o1"><span>✨ Graphics</span><div class="seg" role="radiogroup" aria-label="Graphics quality"></div></div>
        <p class="set-note">Low turns off glow and shadows for older phones.</p>`;
    w.querySelector('#volMusic').addEventListener('input', (e) => setVolume('music', e.target.value / 100));
    w.querySelector('#volSfx').addEventListener('input', (e) => setVolume('sfx', e.target.value / 100));
    const seg = w.querySelector('.seg');
    for (const [key, q] of Object.entries(QUALITIES)) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (getQuality() === key ? 'g-green' : 'g-grey');
        b.textContent = q.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(getQuality() === key));
        b.addEventListener('click', () => { setQuality(key); renderModal(); });
        seg.appendChild(b);
    }
    body.appendChild(w);
}

function rowCard(ic, name, desc, btnText, btnClass, onClick, disabled) {
    const d = document.createElement('div');
    d.className = 'row-card';
    d.innerHTML = '<div class="ic"></div><div><div class="nm o1"></div><div class="ds"></div></div><button class="btn o1"></button>';
    d.querySelector('.ic').textContent = ic;
    d.querySelector('.nm').textContent = name;
    d.querySelector('.ds').textContent = desc;
    const b = d.querySelector('button');
    b.classList.add(btnClass);
    setHtml(b, btnText); b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return d;
}
function sec(text) { const d = document.createElement('div'); d.className = 'sec'; d.textContent = text; return d; }

function renderModal() {
    const body = $('#modalBody');
    const title = $('#modalTitle');
    body.innerHTML = '';
    if (modalKind === 'rebirth') {
        title.textContent = 'Rebirths';
        const cur = 1 + S.rebirths * CFG.rebirthStep, next = cur + CFG.rebirthStep;
        const ready = S.level >= CFG.rebirthLevel;
        const w = document.createElement('div');
        w.className = 'rebirth-box';
        w.innerHTML = `<div class="big o">🔄 ${S.rebirths} Rebirths</div>
            <div class="mult o"><span style="color:#6fe0ff">x${cur}</span><span>➜</span><span style="color:#7dff6b">x${next}</span></div>
            <p>Each rebirth adds +50% to every Step you earn. Your level goes back to 1, so your clones start over too. You keep Wins, clone limits and stage unlocks.</p>
            <p style="color:${ready ? '#7dff6b' : '#ffb51c'};font-weight:700">${ready ? 'Ready to rebirth!' : 'Reach Level ' + CFG.rebirthLevel + ' to rebirth (now Level ' + S.level + ')'}</p>`;
        const b = document.createElement('button');
        b.className = 'btn o ' + (ready ? 'g-green' : 'g-grey');
        b.textContent = 'REBIRTH';
        b.disabled = !ready;
        b.addEventListener('click', () => net.send('rebirth'));
        w.appendChild(b);
        body.appendChild(w);
    } else if (modalKind === 'free') {
        title.textContent = 'FREE Rewards';
        renderFree();
    } else if (modalKind === 'friends') {
        title.textContent = 'Friends';
        renderFriends(body);
    } else if (modalKind === 'settings') {
        title.textContent = 'Settings';
        renderSettings(body);
    } else if (modalKind === 'store') {
        title.textContent = 'Store';
        body.appendChild(sec('Game passes'));
        for (const k of Object.keys(PASSES)) {
            const p = PASSES[k], owned = !!S.passes[k];
            body.appendChild(rowCard(p.ic, p.name, p.desc, owned ? 'OWNED' : bux(p.price), owned ? 'g-grey' : 'g-green', () => buy('pass', k), owned));
        }
        body.appendChild(sec('Steps'));
        for (const k of ['Steps10K', 'Steps100K', 'Steps1M']) {
            const p = PRODUCTS[k];
            body.appendChild(rowCard('👟', p.name, 'Instant Steps (and levels)', bux(p.price), 'g-yellow', () => buy('product', k)));
        }
        body.appendChild(rowCard('⏱️', 'x2 Steps Boost', '15 minutes of double Steps', bux(PRODUCTS.StepsBoost.price), 'g-yellow', () => buy('product', 'StepsBoost')));
        if (!S.claimedPack) body.appendChild(rowCard('🎁', 'Starter Pack', '+20K Steps and +10 Wins, once', bux(PRODUCTS.StarterPack.price), 'g-pink', () => buy('product', 'StarterPack')));
    }
}
// Bloxity friends with presence, a shareable invite link and per-friend invites
function renderFriends(body) {
    const note = (text) => { const p = document.createElement('p'); p.className = 'set-note'; p.textContent = text; body.appendChild(p); return p; };
    if (!BX.bloxity.ready) { note('Bloxity is not available right now.'); return; }
    const id = BX.identity();
    const link = document.createElement('div');
    link.className = 'invite-row';
    link.innerHTML = '<input id="inviteLink" readonly aria-label="Invite link"><button class="btn g-green o1" id="copyInvite">Copy link</button>';
    body.appendChild(link);
    const input = link.querySelector('input');
    input.value = BX.getInviteLink();
    link.querySelector('button').addEventListener('click', async () => {
        input.select();
        try { await navigator.clipboard.writeText(input.value); toast('Invite link copied!', '#7dff6b'); }
        catch (e) { document.execCommand && document.execCommand('copy'); toast('Select the link and copy it', '#ffb51c'); }
    });
    if (!id.loggedIn) {
        note('Log in with Bloxity to see your friends and invite them into this server.');
        const b = document.createElement('button');
        b.className = 'btn g-blue o1'; b.textContent = 'Log in with Bloxity';
        b.addEventListener('click', () => BX.login());
        body.appendChild(b);
        return;
    }
    const loading = note('Loading friends…');
    BX.getFriends().then((friends) => {
        if (modalKind !== 'friends') return;
        loading.remove();
        if (!friends.length) { note('No friends yet. Share the invite link above!'); return; }
        const order = { 'in-game': 0, online: 1, away: 2, offline: 3 };
        friends.sort((a, b) => (order[a.presence && a.presence.status] ?? 4) - (order[b.presence && b.presence.status] ?? 4));
        for (const f of friends) {
            const st = (f.presence && f.presence.status) || 'offline';
            const where = st === 'in-game' && f.presence.gameName ? 'Playing ' + f.presence.gameName : st;
            const dot = st === 'offline' ? '⚫' : st === 'away' ? '🟡' : '🟢';
            body.appendChild(rowCard(dot, f.displayName || f.username, where, 'Invite', 'g-green', async (e) => {
                e.currentTarget.disabled = true;
                const ok = await BX.inviteFriend(f._id);
                toast(ok ? 'Invite sent to ' + (f.displayName || f.username) : 'Could not send the invite', ok ? '#7dff6b' : '#ff5a5a');
            }));
        }
    });
}

function renderFree() {
    const body = $('#modalBody');
    body.innerHTML = '';
    const mins = (net.now() - S.joinedAt) / 60000;
    FREE.forEach((r, i) => {
        const claimed = !!S.freeClaimed[i];
        const ready = mins >= r.min;
        const name = r.steps ? '+' + fmt(r.steps) + ' Steps' : '+' + r.wins + ' Wins';
        const btn = claimed ? 'Claimed' : ready ? 'CLAIM' : clock(r.min * 60 - mins * 60);
        body.appendChild(rowCard(r.steps ? '👟' : '🏆', name, 'Play for ' + r.min + ' min', btn,
            claimed ? 'g-grey' : ready ? 'g-green' : 'g-blue', () => { if (!claimed && ready) net.send('free', { i }); }, claimed || !ready));
    });
}
