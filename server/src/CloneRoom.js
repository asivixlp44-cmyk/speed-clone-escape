import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, claimGrants, queueGrant, USE_DB,
} from './profiles.js';
import { verifyBloxityToken, BUX_MODE } from './bloxity.js';
import {
    CFG, LOBBY, STAGES, PORTALS, portalOpen, LIMITS, PRODUCTS, PASSES, QUESTS, FREE, DAILY, dailyStatus, dayKey, KITS, SKINS,
    xpFor, ownedClones, cloneLimit, stepsMult, treadmillAt, stageAt, fmt, comma, clamp,
} from '../../shared/config.js';

const GREEN = '#7dff6b', RED = '#ff5a5a', GOLD = '#ffd028', BLUE = '#6fe0ff';

// Empty string when the player left the name box blank
function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');

export const liveRooms = new Set();

// One shared world: lobby + the 6-stage corridor. Movement and monsters are client-side;
// everything that changes progress (Steps, levels, clones, Wins, unlocks, purchases) is decided here.
export class CloneRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;

        this.onMessage('move', (client, m) => this.onMove(client, m));
        this.onMessage('caught', (client, m) => this.onCaught(client, m));
        this.onMessage('pad', (client, m) => this.onPad(client, m));
        this.onMessage('gem', (client, m) => this.onGem(client, m));
        this.onMessage('limit', (client, m) => this.onLimit(client, m));
        this.onMessage('portal', (client, m) => this.onPortal(client, m));
        this.onMessage('rebirth', (client) => this.onRebirth(client));
        this.onMessage('free', (client, m) => this.onFree(client, m));
        this.onMessage('daily', (client) => this.onDaily(client));
        this.onMessage('buy', (client, m) => this.onBuy(client, m));
        this.onMessage('tutorial', (client) => this.onTutorial(client));
        this.onMessage('auth', (client, m) => this.onBloxityLogin(client, m));
        this.onMessage('avatar', (client, m) => this.onAvatar(client, m));
        this.onMessage('emote', (client, m) => this.onEmote(client, m));
        this.onMessage('chat', (client, m) => this.onChat(client, m));

        this.setSimulationInterval((dt) => this.tick(dt), 100);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        // Bux purchases for players on this pod that were confirmed while they were elsewhere
        if (USE_DB) this.clock.setInterval(() => this.applyQueuedGrants(), 5000);
    }

    // A Bloxity token is verified with the Bloxity API; anyone else joins as a guest
    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        const profile = getProfile(uid, name, randomName());
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = LOBBY.spawn.x; player.y = LOBBY.spawn.y; player.z = LOBBY.spawn.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        this.sessions.set(client.sessionId, {
            client, profile, player,
            moving: false, lastMove: 0, gainT: 0, lost: 0, dead: false,
            joinedAt: Date.now(), freeClaimed: {}, cooldowns: new Map(), guest, lastChat: 0,
        });
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bux: BUX_MODE, bloxity: uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
        if (USE_DB) this.applyQueuedGrants();
    }

    // A dropped connection (tunnel hiccup, phone switching networks) keeps the player in
    // the world for 30 s so the client can reconnect without losing its place
    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bux: BUX_MODE, bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (s && !isOnline(s.profile.uid)) releaseProfile(s.profile.uid);
    }

    // Colyseus awaits this on SIGTERM, which is how Legion stops a pod on every deploy
    onDispose() { liveRooms.delete(this); markDirty(); return saveProfiles(); }

    async applyQueuedGrants() {
        const uids = [...this.sessions.values()].map((s) => s.profile.uid);
        let grants = [];
        try { grants = await claimGrants(uids); } catch (e) { return console.warn('[DB] grants:', e.message); }
        for (const g of grants) {
            const entry = [...this.sessions].find(([, s]) => s.profile.uid === g.uid);
            if (entry) { this.grant({ ...entry[1], id: entry[0] }, g.kind, g.key); continue; }
            // Left between the query and now: put it back for their next visit
            queueGrant(g.uid, g.name, g.kind, g.key, g.tx).catch(() => {});
        }
        if (grants.length) saveProfiles();
    }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        const owned = ownedClones(p);
        s.lost = Math.min(s.lost, owned);
        pl.steps = p.steps; pl.wins = p.wins; pl.level = p.level; pl.xp = p.xp; pl.rebirths = p.rebirths;
        pl.owned = owned; pl.clones = owned - s.lost; pl.limit = cloneLimit(p);
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            limits: p.limits, portals: p.portals, passes: p.passes, quest: p.quest, totalWins: p.totalWins, best: p.best,
            boostUntil: p.boostUntil, claimedPack: p.claimedPack, seenTutorial: p.seenTutorial,
            firstPlay: p.firstPlay, freeClaimed: s.freeClaimed, joinedAt: s.joinedAt, daily: dailyStatus(p, Date.now()),
        });
    }
    toast(s, text, color) { s.client.send('toast', { text, color }); }
    cooldown(s, key, seconds) {
        const now = Date.now();
        if ((s.cooldowns.get(key) || 0) > now) return false;
        s.cooldowns.set(key, now + seconds * 1000);
        return true;
    }
    changed(id) {
        const s = this.sessions.get(id);
        if (s) this.checkQuest(s);
        this.syncPublic(id); this.sendProfile(id); markDirty();
    }

    addSteps(s, amount, boosted) {
        const p = s.profile;
        if (!(amount > 0)) return 0;
        if (boosted) amount = Math.floor(amount * stepsMult(p) + 0.5);
        p.steps += amount;
        // XP is earned 1:1 with Steps; every level is one more clone (up to the limit)
        const old = p.level, oldClones = ownedClones(p);
        p.xp += amount;
        while (p.xp >= xpFor(p.level)) { p.xp -= xpFor(p.level); p.level++; }
        if (p.level > old) {
            s.client.send('levelUp', { from: old, to: p.level, clones: ownedClones(p) - oldClones });
            this.checkQuest(s);
        }
        markDirty();
        return amount;
    }
    addWins(s, n, boosted) {
        if (boosted && s.profile.passes.DoubleWins) n *= 2;
        s.profile.wins += n;
        s.profile.totalWins += n;
        markDirty();
        return n;
    }
    // Quest chain: completes automatically and pays its reward
    checkQuest(s) {
        const p = s.profile;
        for (let guard = 0; guard < QUESTS.length; guard++) {
            const q = QUESTS[p.quest];
            if (!q || (p[q.stat] || 0) < q.n) return;
            p.quest++;
            if (q.reward.steps) this.addSteps(s, q.reward.steps, false);
            if (q.reward.wins) this.addWins(s, q.reward.wins, false);
            s.client.send('quest', { text: q.text, reward: q.reward });
            this.sendProfile(s.client.sessionId);
        }
    }

    // ----- simulation -----
    tick(dt) {
        const now = Date.now();
        for (const [id, s] of this.sessions) {
            const pl = s.player;
            s.profile.playtime = (s.profile.playtime || 0) + dt / 1000;

            // Steps from running, every 0.4 s: (you + every clone) x multipliers
            s.gainT += dt / 1000;
            if (s.gainT < CFG.gainInterval) continue;
            s.gainT -= CFG.gainInterval;
            if (s.dead || now - s.lastMove > 1500) continue;
            let mult = 1, tread = treadmillAt(pl.x, pl.y, pl.z);
            if (tread && tread.pass && !s.profile.passes[tread.pass]) tread = null;
            if (tread) mult = tread.mult;
            else if (!s.moving || now - s.lastMove > 700) continue;
            const got = this.addSteps(s, (1 + pl.clones) * mult, true);
            this.syncPublic(id);
            s.client.send('gain', { n: got, t: tread ? 1 : 0 });
        }
    }

    broadcastBoards(target) {
        const top = (key) => topProfiles(key).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const msg = { steps: top('steps'), wins: top('totalWins'), playtime: top('playtime') };
        if (target) target.send('boards', msg); else this.broadcast('boards', msg);
    }

    // ----- messages -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, -200, 200);
        pl.y = clamp(m.y, -100, 200);
        pl.z = clamp(m.z, -200, 4000);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 3);
        s.dead = pl.anim === 3;
        s.moving = !!m.mv;
        s.lastMove = Date.now();
        // Back in the lobby: every clone the monsters ate comes back
        if (pl.z < LOBBY.halfZ - 1 && !s.dead && s.lost > 0) { s.lost = 0; this.syncPublic(client.sessionId); }
    }

    // A monster reached the player: it eats a clone, or the player when none are left
    onCaught(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || stageAt(s.player.z) < 0) return;
        if (!this.cooldown(s, 'caught', 0.25)) return;
        if (s.player.clones > 0) s.lost++;
        else { s.dead = true; s.player.anim = 3; }
        this.syncPublic(client.sessionId);
    }

    onPad(client, m) {
        const s = this.sessions.get(client.sessionId);
        const idx = m ? m.s | 0 : -1;
        const st = STAGES[idx];
        if (!s || !st) return;
        const z = s.player.z;
        if (z < st.cE - 5 || z > st.zE + 5) return;
        if (!this.cooldown(s, 'pad', 2)) return;
        const got = this.addWins(s, st.wins, true);
        s.profile.best = Math.max(s.profile.best || 0, idx + 1);
        client.send('wins', { n: got, stage: idx });
        this.changed(client.sessionId);
    }

    // Step gem picked up inside a stage: worth the stage's gem value for you and every clone
    onGem(client, m) {
        const s = this.sessions.get(client.sessionId);
        const idx = m ? m.s | 0 : -1;
        const st = STAGES[idx];
        if (!s || !st || s.dead || stageAt(s.player.z) !== idx) return;
        const id = String(m.id).slice(0, 24);
        if (!this.cooldown(s, 'gem:' + idx + ':' + id, 12)) return;
        const got = this.addSteps(s, st.gem * (1 + s.player.clones), true);
        this.syncPublic(client.sessionId);
        client.send('gain', { n: got, gem: 1 });
    }

    onLimit(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m ? m.i | 0 : -1;
        const def = LIMITS[i];
        if (!s || !def) return;
        const p = s.profile;
        if (p.limits[i]) return;
        if (i > 0 && !p.limits[i - 1]) return this.toast(s, 'Unlock the step below first!', RED);
        if (p.wins < def.cost) return this.toast(s, 'You need ' + comma(def.cost - p.wins) + ' more wins to unlock this!', RED);
        p.wins -= def.cost;
        p.limits[i] = true;
        client.send('limitUp', { add: def.add, limit: cloneLimit(p) });
        this.changed(client.sessionId);
    }

    onPortal(client, m) {
        const s = this.sessions.get(client.sessionId);
        const portal = m && PORTALS.find((p) => p.stage === (m.stage | 0));
        if (!s || !portal) return;
        if (portal.soon || portal.stage > STAGES.length) return this.toast(s, 'Coming soon!', BLUE);
        const p = s.profile;
        if (!portalOpen(portal, p.portals)) {
            if (p.wins < portal.cost) return this.toast(s, 'You need ' + comma(portal.cost - p.wins) + ' more wins to unlock this!', RED);
            p.wins -= portal.cost;
            p.portals[portal.stage] = true;
            this.toast(s, 'Stage ' + portal.stage + ' unlocked!', GREEN);
            this.changed(client.sessionId);
        }
        client.send('portalOk', { stage: portal.stage });
    }

    onRebirth(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.level < CFG.rebirthLevel) return this.toast(s, 'Reach Level ' + CFG.rebirthLevel + ' to Rebirth!', RED);
        p.rebirths++;
        p.level = 1; p.xp = 0;
        this.toast(s, 'REBIRTH! Steps are now x' + (1 + p.rebirths * CFG.rebirthStep), BLUE);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    onFree(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m ? m.i | 0 : -1;
        const r = FREE[i];
        if (!s || !r || s.freeClaimed[i]) return;
        if ((Date.now() - s.joinedAt) / 60000 < r.min) return;
        s.freeClaimed[i] = true;
        if (r.steps) this.addSteps(s, r.steps, false); else this.addWins(s, r.wins, false);
        this.toast(s, 'Claimed ' + (r.steps ? '+' + fmt(r.steps) + ' Steps' : '+' + r.wins + ' Wins') + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p, now);
        if (!st.ready) return this.toast(s, 'Come back tomorrow for the next reward!', BLUE);
        const r = DAILY[st.day];
        p.dailyStreak = (p.dailyDay === dayKey(now - 86400000) ? p.dailyStreak : 0) + 1;
        p.dailyDay = dayKey(now);
        if (r.steps) this.addSteps(s, r.steps, false);
        if (r.wins) this.addWins(s, r.wins, false);
        this.toast(s, 'Day ' + (st.day + 1) + ' reward: ' + [r.steps ? '+' + fmt(r.steps) + ' Steps' : '', r.wins ? '+' + r.wins + ' Wins' : ''].filter(Boolean).join(' & ') + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    onTutorial(client) {
        const s = this.sessions.get(client.sessionId);
        if (s && !s.profile.seenTutorial) { s.profile.seenTutorial = true; this.sendProfile(client.sessionId); markDirty(); }
    }

    // Demo mode grants for free. In Bux mode (LEGION_WEBHOOK_SECRET set) only the webhook grants.
    onBuy(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m) return;
        if (BUX_MODE) return this.toast(s, 'Purchases use Bux - log in to Bloxity', BLUE);
        this.grant({ ...s, id: client.sessionId }, m.kind, m.key);
    }

    // s is a live session, or a stand-in { profile, client: { send() {} } } for offline players
    grant(s, kind, key) {
        const client = s.client;
        const p = s.profile;
        if (kind === 'pass') {
            const pass = PASSES[key];
            if (!pass) return false;
            if (p.passes[key]) { this.toast(s, pass.name + ' already owned!', BLUE); return true; }
            p.passes[key] = true;
            this.toast(s, pass.name + ' unlocked!', GREEN);
        } else {
            const prod = PRODUCTS[key];
            if (!prod) return false;
            if (key === 'Revive') {
                // Revive brings every eaten clone back too
                const live = s.id && this.sessions.get(s.id);
                if (live) { live.lost = 0; live.dead = false; this.syncPublic(s.id); }
                client.send('revived', {});
                return true;
            }
            if (key === 'StepsBoost') {
                p.boostUntil = Math.max(Date.now(), p.boostUntil) + CFG.boostMinutes * 60000;
                this.toast(s, 'x2 Steps Boost active!', GOLD);
            }
            if (key === 'StarterPack') {
                if (p.claimedPack) { this.toast(s, 'Starter Pack already claimed!', BLUE); return true; }
                p.claimedPack = true;
            }
            if (prod.steps) { this.addSteps(s, prod.steps, false); this.toast(s, '+' + fmt(prod.steps) + ' Steps!', GREEN); }
            if (prod.wins) { this.addWins(s, prod.wins, false); this.toast(s, '+' + prod.wins + ' Wins!', GOLD); }
        }
        client.send('fx', { kind: 'confetti' });
        if (s.id) this.changed(s.id); else markDirty();
        return true;
    }

    // ----- Bloxity -----
    // Logged in to Bloxity after joining: move this session onto the Bloxity profile
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    // Emote ids are opaque catalogue ids; other players play the same clip
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}

// Grants a Bux purchase confirmed by the Bloxity webhook, whether or not the player is online
export async function grantPurchase(uid, name, kind, key, tx) {
    for (const room of liveRooms) {
        for (const [id, s] of room.sessions) {
            if (s.profile.uid === uid) return room.grant({ ...s, id }, kind, key);
        }
    }
    // Not on this pod: the pod hosting them (or their next join) applies it
    if (USE_DB) { await queueGrant(uid, name, kind, key, tx); return true; }
    const profile = getProfile(uid, name, randomName());
    const stub = { profile, client: { send() {} } };
    const proto = CloneRoom.prototype;
    return proto.grant.call({ toast() {}, addSteps: proto.addSteps, addWins: proto.addWins, checkQuest() {}, changed() {}, sessions: new Map() }, stub, kind, key);
}
