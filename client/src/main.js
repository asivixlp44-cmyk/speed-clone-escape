import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, solids, kills, triggers, prompts, tickers,
    billboard, buildRig, animRig, airPose, buildMonster, mergeStatic, burst, confettiAt, floatText, updateEffects, lerpAngle,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, startMusic, sfx, setVolume } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar, avatarStats } from './avatar.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import { render, setSpeedLines, updateFx, dust, sparkleColumn, ring, fireworks, setQuality } from './fx.js';
import { updateStages, stageReset, bossZ } from './stages.js';
import { buildWorld, SPAWN, beltTex, refreshWorld, renderBoards, treadLocked, updateScreens } from './world.js';
import {
    updateHud, toast, levelUp, bigText, showStageTitle, buy, showRevive, hideRevive, closeModal, openModal,
    refreshModal, promptEl, promptTxtEl, showWin, animateCounters, popGain, showTutorial, eatFlash, notice, popLoss, updateStageBar, showClear,
} from './ui.js';
import { CFG, LOBBY, STAGES, KITS, SKINS, stageAt, clamp } from '../../shared/config.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.7, GRAV = 196.2, JUMP_V = 50;
const P = {
    pos: SPAWN.clone(), vel: new V3(), knock: new V3(), onGround: false, ground: null, facing: 0,
    dead: false, shield: 0, lastSafe: SPAWN.clone(), safeTimer: 0, stage: -1, moving: false, autoRun: false,
    animPhase: 0, lockToastT: -9, squash: 1, squashV: 0, airTime: 0, lastStep: 0, lost: 0,
};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig, myCrowd = null;
// Clones still with you: owned clones minus the ones monsters ate on this run
const aliveClones = () => Math.max(0, S.owned - P.lost);

// ----- Bloxity avatars -----
// The Bloxity body replaces the blocky rig's meshes; labels stay on the rig group.
function dressRig(group, avatar) {
    group.children.forEach((c) => { if (!c.isSprite) c.visible = false; });
    group.add(avatar.root);
    group.userData.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    if (myCrowd) myCrowd.setLook(av, BX.getSkinTextureUrl());
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
// Chat bubble above a rig for a few seconds
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#16121f', px: 44 }], 9, 1024, new V3(0, 9.4, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}
// Fallback blocky look (until the Bloxity body loads). Your own look is the reference one:
// pale skin, big orange hair, black tee, dark jeans; other players get varied kits.
const lookOf = (kit, skin) => { const k = KITS[kit % KITS.length]; return { ...k, skin: k.skin || SKINS[skin % SKINS.length], hairStyle: 'shaggy', plain: true }; };

function buildPlayer(kit, skin) {
    if (rig) scene.remove(rig);
    rig = buildRig(lookOf(kit, skin));
    scene.add(rig);
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
    if (myCrowd) myCrowd.dispose();
    myCrowd = new Crowd(lookOf(kit, skin), isTouch ? 12 : CFG.maxCloneModels);
    myCrowd.setLook(BX.currentAvatar(), BX.getSkinTextureUrl());
}

// =====================================================================================
// Clone crowd: clones run behind their owner along the path the owner walked
// =====================================================================================
const tmpA = new V3(), tmpB = new V3(), tmpC = new V3(), tmpDir = new V3();
class Crowd {
    constructor(look, max) {
        this.look = look; this.max = max;
        this.members = []; this.hist = [];
        this.av = null; this.skinUrl = '';
    }
    setLook(av, skinUrl) {
        this.av = av; this.skinUrl = skinUrl;
        for (const m of this.members) this.dress(m);
    }
    dress(m) {
        const req = (m.req = (m.req || 0) + 1);
        createAvatar(this.av, this.skinUrl || undefined).then((a) => {
            if (!a) return;
            if (m.gone || req !== m.req) { a.dispose(); return; }
            if (m.blox) m.blox.dispose();
            m.blox = a;
            dressRig(m.g, a);
        });
    }
    count() { return this.members.length; }
    // Grow or shrink to n clones; new ones split off the owner with a sparkle
    setCount(n, owner, effects) {
        n = Math.min(n, this.max);
        while (this.members.length < n) {
            const g = buildRig(this.look);
            g.position.copy(owner);
            scene.add(g);
            const m = { g, blox: null, phase: Math.random() * 6, speed: 0 };
            this.members.push(m);
            this.dress(m);
            if (effects) { sparkleColumn(owner, 0x7dff6b); ring(owner, 0x7dff6b, 4, 0.5); }
        }
        while (this.members.length > n) this.remove(this.members.length - 1, false);
    }
    remove(i, poof) {
        const m = this.members[i];
        if (!m) return;
        if (poof) {
            const at = m.g.position.clone().add(new V3(0, 2.5, 0));
            burst(at, 0x16121f, 1, 18); burst(at, 0xffffff, 0.6, 10);
        }
        m.gone = true;
        if (m.blox) m.blox.dispose();
        scene.remove(m.g);
        this.members.splice(i, 1);
    }
    // Index of the clone closest to a point (the one a monster bites)
    nearest(p) {
        let best = -1, bd = Infinity;
        this.members.forEach((m, i) => { const d = m.g.position.distanceToSquared(p); if (d < bd) { bd = d; best = i; } });
        return best;
    }
    reset(owner) {
        this.hist.length = 0;
        this.hist.push(owner.clone());
        for (const m of this.members) m.g.position.copy(owner);
    }
    record(owner) {
        const h = this.hist;
        if (!h.length || h[h.length - 1].distanceToSquared(owner) > 0.36) {
            h.push(owner.clone());
            if (h.length > 500) h.shift();
        } else h[h.length - 1].y = owner.y;
    }
    // Point `d` along the walked path behind the owner, plus the path direction there
    pathPoint(d, out, dir, facing) {
        const h = this.hist;
        let acc = 0;
        for (let i = h.length - 1; i > 0; i--) {
            const a = h[i], b = h[i - 1];
            const seg = a.distanceTo(b);
            if (acc + seg >= d) {
                const k = (d - acc) / (seg || 1);
                out.lerpVectors(a, b, k);
                dir.subVectors(a, b).setY(0).normalize();
                return out;
            }
            acc += seg;
        }
        // Path shorter than d: continue straight back from the oldest point
        const o = h[0] || out;
        dir.set(Math.sin(facing), 0, Math.cos(facing));
        return out.copy(o).addScaledVector(dir, -(d - acc));
    }
    update(dt, owner, facing, ownerMoving, t, visible) {
        this.record(owner);
        const k = 1 - Math.exp(-dt * 9);
        this.members.forEach((m, i) => {
            const row = Math.floor(i / 3), col = (i % 3) - 1;
            this.pathPoint(5 + row * 3.8, tmpA, tmpDir, facing);
            const side = col * 3.6 + (row % 2 ? 1.6 : -0.6);
            tmpA.x += tmpDir.z * side; tmpA.z -= tmpDir.x * side;
            const g = m.g;
            tmpB.copy(g.position);
            if (g.position.distanceToSquared(tmpA) > 40 * 40) g.position.copy(tmpA);
            else {
                g.position.x += (tmpA.x - g.position.x) * k;
                g.position.z += (tmpA.z - g.position.z) * k;
                g.position.y += (tmpA.y - g.position.y) * Math.min(1, dt * 14);
            }
            const dx = g.position.x - tmpB.x, dz = g.position.z - tmpB.z;
            const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
            m.speed += (sp - m.speed) * Math.min(1, dt * 8);
            const run = m.speed > 2 || ownerMoving;
            if (sp > 1.5) g.rotation.y = lerpAngle(g.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12));
            else g.rotation.y = lerpAngle(g.rotation.y, facing, 1 - Math.exp(-dt * 4));
            m.phase += dt * (run ? 14 : 0);
            if (m.blox) m.blox.update(dt, { moving: run, air: false, speed: CFG.walkSpeed, t: t + i });
            else animRig(g, m.phase, run ? 0.9 : 0);
            g.visible = visible;
        });
    }
    dispose() { while (this.members.length) this.remove(0, false); }
}

// =====================================================================================
// Collision
// =====================================================================================
function overlapsBox(c, x, y, z) {
    return c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
}
function freeAt(x, y, z) {
    for (const c of solids) if (overlapsBox(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of solids) {
        if (!overlapsBox(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}

function teleport(pos, yaw) {
    P.pos.copy(pos); P.vel.set(0, 0, 0);
    P.lastSafe.copy(pos);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    for (const t of triggers) t.inside = overlapsBox(t, pos.x, pos.y, pos.z);
    if (myCrowd) myCrowd.reset(pos);
    sendMove(true);
}
function teleportLobby() {
    setStage(-1);
    teleport(SPAWN, 0);
}

function die() {
    if (P.dead || P.shield > 0) return;
    P.dead = true;
    eatFlash();
    burst(P.pos.clone().add(new V3(0, 2.5, 0)), 0x16121f, 1.2, 30);
    sfx('chomp'); sfx('death'); addShake(1); rumble(1, 450);
    sendMove(true);
    // Swallowed: the screen goes black, then you wake up back in the lobby
    setTimeout(() => { if (P.dead) actions.revive(false); }, 1500);
}
actions.revive = (atSpot) => {
    hideRevive();
    if (!P.dead) return;
    P.dead = false;
    if (atSpot) {
        P.lost = 0;
        teleport(P.lastSafe.clone(), P.facing);
        P.shield = CFG.shieldTime;
        for (const m of activeMonsters()) m.state = 'retreat';
    } else teleportLobby();
};

// =====================================================================================
// Shadow monsters (local to each player, like a private run of the stage)
// =====================================================================================
const monsterSets = new Map(); // stage index -> [{g, home, pos, state, t, cool, yaw}]
function monstersFor(idx) {
    if (!monsterSets.has(idx)) {
        const s = STAGES[idx];
        monsterSets.set(idx, s.spots.map((sp, k) => {
            const g = buildMonster();
            g.scale.setScalar(1.45);
            const home = new V3(sp.x, 6, sp.z);
            g.position.copy(home); g.rotation.y = Math.PI;
            scene.add(g);
            return { g, home, k, pos: home.clone(), state: 'idle', t: 0, cool: 0, yaw: Math.PI, chomp: 0, phase: Math.random() * 6 };
        }));
    }
    return monsterSets.get(idx);
}
const activeMonsters = () => (P.stage >= 0 ? monstersFor(P.stage) : []);
function setStage(idx) {
    if (P.stage === idx) return;
    if (P.stage >= 0) stageReset(P.stage);
    P.stage = idx;
    for (const [i, set] of monsterSets) for (const m of set) {
        m.g.visible = i === idx;
        m.state = 'idle'; m.pos.copy(m.home); m.g.position.copy(m.home); m.cool = 0.4 + m.k * 0.9;
    }
    if (idx >= 0) for (const m of monstersFor(idx)) m.g.visible = true;
}
let lastCatch = 0;
// Anything that hurts you inside a stage costs one clone (the given crowd member, or the
// one nearest the hit). With no clones left it is you. Returns false while on cooldown.
function takeHit(at, member, opts) {
    opts = opts || {};
    const now = performance.now();
    if (now - lastCatch < 300 || P.dead) return false;
    lastCatch = now;
    sendMove(true);
    net.send('caught', { s: P.stage });
    if (aliveClones() > 0) {
        P.lost++;
        const i = member !== undefined && member >= 0 ? member : myCrowd ? myCrowd.nearest(at) : -1;
        if (i >= 0 && myCrowd && myCrowd.count() > aliveClones()) myCrowd.remove(i, true);
        sfx(opts.zap ? 'hit' : 'chomp'); sfx('poof'); addShake(0.45); rumble(0.5, 160);
        if (opts.knock) {
            // Shoved away from the hazard, briefly protected
            const away = tmpC.subVectors(P.pos, at).setY(0);
            if (away.lengthSq() < 0.01) away.set(0, 0, -1);
            away.normalize();
            P.vel.y = 30; P.onGround = false; P.knock.copy(away).multiplyScalar(28);
            P.shield = Math.max(P.shield, 0.9);
        }
        popLoss(aliveClones());
    } else die();
    return true;
}
function monsterCatch(m) {
    if (!takeHit(m.pos)) return;
    m.chomp = 1; m.state = 'retreat'; m.cool = 1.4 + Math.random();
}
// Fell into lava: lose a clone and pop back onto the bridge
function lavaFall() {
    if (P.dead) return;
    const s = STAGES[P.stage];
    if (aliveClones() <= 0) { P.shield = 0; die(); return; }
    takeHit(P.pos.clone());
    const z = P.lastSafe.z;
    teleport(new V3(s && s.pathX ? s.pathX(z) : P.lastSafe.x, 0.5, z), P.facing);
    P.shield = 1.5;
    sfx('land');
}
function updateMonsters(dt, t) {
    if (P.stage < 0) return;
    const s = STAGES[P.stage];
    const crowd = myCrowd ? myCrowd.members : [];
    const set = monstersFor(P.stage);
    // At most two monsters lunge at the same time, so a big clone army can soak the bites
    let attacking = set.filter((x) => x.state === 'windup' || x.state === 'charge').length;
    for (const m of set) {
        m.cool -= dt;
        const toP = tmpA.subVectors(P.pos, m.pos).setY(0);
        const dist = toP.length();
        if (m.state === 'idle') {
            m.pos.lerp(m.home, 1 - Math.exp(-dt * 2));
            m.yaw = lerpAngle(m.yaw, Math.atan2(toP.x, toP.z), 1 - Math.exp(-dt * 3));
            // The row at the far end takes turns lunging at you while you approach
            if (!P.dead && P.shield <= 0 && m.cool <= 0 && dist < s.wake && attacking < 2) {
                m.state = 'windup'; m.t = 0; attacking++;
                sfx('roar'); addShake(0.25);
            }
        } else if (m.state === 'windup') {
            // Rears back and roars before it lunges: the player's cue to dodge
            m.t += dt;
            m.yaw = lerpAngle(m.yaw, Math.atan2(toP.x, toP.z), 1 - Math.exp(-dt * 8));
            m.pos.y += (8.5 - m.pos.y) * Math.min(1, dt * 5);
            if (m.t > 0.55) { m.state = 'charge'; m.t = 0; }
        } else if (m.state === 'charge') {
            m.t += dt;
            // Steers toward the player with a limited turn rate, so a side-step can dodge it
            const want = Math.atan2(toP.x, toP.z);
            let d = want - m.yaw;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            m.yaw += clamp(d, -1.7 * dt, 1.7 * dt);
            m.pos.x += Math.sin(m.yaw) * s.mSpeed * dt;
            m.pos.z += Math.cos(m.yaw) * s.mSpeed * dt;
            m.pos.y += (4.2 - m.pos.y) * Math.min(1, dt * 4);
            m.pos.x = clamp(m.pos.x, -CFG.courseWidth / 2 + 3, CFG.courseWidth / 2 - 3);
            if (P.dead || P.shield > 0 || m.t > 3.2) { m.state = 'retreat'; m.cool = 1 + Math.random(); }
            else {
                let hit = dist < 4 && Math.abs(P.pos.y + 2.5 - m.pos.y) < 6;
                if (!hit) for (const c of crowd) if (c.g.position.distanceToSquared(tmpB.set(m.pos.x, c.g.position.y + 2.5, m.pos.z)) < 16) { hit = true; break; }
                if (hit) monsterCatch(m);
            }
        } else {
            const back = tmpC.subVectors(m.home, m.pos);
            const bl = back.length();
            if (bl < 1) { m.state = 'idle'; m.cool = Math.max(m.cool, 0.8); }
            else {
                m.pos.addScaledVector(back, Math.min(1, s.mSpeed * 1.2 * dt / bl));
                m.yaw = lerpAngle(m.yaw, Math.atan2(back.x, back.z), 1 - Math.exp(-dt * 6));
            }
        }
        // Wobble, breathe and snap the jaw
        m.chomp = Math.max(0, m.chomp - dt * 2.5);
        const u = m.g.userData;
        const bob = Math.sin(t * 3 + m.phase) * 0.35;
        m.g.position.set(m.pos.x, m.pos.y + bob, m.pos.z);
        m.g.rotation.y = m.yaw;
        const charging = m.state === 'charge' || m.state === 'windup';
        u.body.scale.set(1 + Math.sin(t * 7 + m.phase) * 0.04, 1 - Math.sin(t * 7 + m.phase) * 0.04 + m.chomp * 0.15, 1);
        u.body.rotation.x = charging ? 0.35 : 0;
        u.jaw.position.y = -0.6 - (charging ? 0.45 + Math.abs(Math.sin(t * 14)) * 0.5 : 0.15) + m.chomp * 0.8;
    }
}

// =====================================================================================
// Stage hazards, gems and the boss (stages.js) talk back through this context
// =====================================================================================
const stageCtx = {
    player: null, dead: false, shield: 0, alert: false,
    // Index of a clone that has fallen behind z (the boss eats the back of the line first)
    crowdBehind(z) {
        if (!myCrowd || aliveClones() <= 0) return -1;
        let best = -1, bz = Infinity;
        myCrowd.members.forEach((m, i) => { if (m.g.position.z < z && m.g.position.z < bz) { bz = m.g.position.z; best = i; } });
        return best;
    },
    eatMember(i, at) { takeHit(at, i); },
    hitPlayer(at, boss) { takeHit(at, undefined, { knock: !boss, zap: !boss }); },
    roar() { sfx('roar'); addShake(0.6); toast('☠ THE BOSS IS COMING - RUN! ☠', '#ff5a5a'); },
    shake(a) { addShake(a); },
    gem(stage, id, at) {
        net.send('gem', { s: stage, id });
        sfx('pickup'); sparkleColumn(at.setY(P.pos.y), 0x5ff0ff);
    },
};
Object.defineProperty(stageCtx, 'player', { get: () => P.pos });
Object.defineProperty(stageCtx, 'dead', { get: () => P.dead });
Object.defineProperty(stageCtx, 'shield', { get: () => P.shield });
Object.defineProperty(stageCtx, 'alert', { get: () => activeMonsters().some((m) => m.state === 'windup' || m.state === 'charge') });

// =====================================================================================
// Guide arrows: a trail of big white arrowheads from you to where you should go next
// (the Stage 1 screen from the lobby, the +Win pad inside a stage)
// =====================================================================================
const GUIDE_N = 9, GUIDE_GAP = 3.6;
const guideArrows = (() => {
    const shape = new T.Shape();
    shape.moveTo(0, 1.6); shape.lineTo(1.25, -1.1); shape.lineTo(0, -0.45); shape.lineTo(-1.25, -1.1); shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 1 });
    geo.translate(0, 0, -0.17);
    const front = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb8d8, emissiveIntensity: 0.35 });
    const list = [];
    for (let i = 0; i < GUIDE_N; i++) {
        const m = new T.Mesh(geo, front);
        m.visible = false;
        scene.add(m);
        list.push(m);
    }
    return list;
})();
let guidePhase = 0;
const guideGoal = new V3(), guideDir = new V3();
function guideTarget(out) {
    if (P.stage < 0) return out.set(0, 0, LOBBY.halfZ);
    const s = STAGES[P.stage];
    return out.set(10, 0, s.cE + 18);
}
function updateGuide(dt) {
    guidePhase = (guidePhase + dt * 5) % GUIDE_GAP;
    guideTarget(guideGoal);
    guideDir.subVectors(guideGoal, P.pos).setY(0);
    const len = guideDir.length();
    guideDir.normalize();
    const yaw = Math.atan2(guideDir.x, guideDir.z);
    guideArrows.forEach((m, i) => {
        const d = 3 + i * GUIDE_GAP + guidePhase;
        m.visible = !P.dead && d < len - 2;
        if (!m.visible) return;
        m.position.set(P.pos.x + guideDir.x * d, P.pos.y + 1.1, P.pos.z + guideDir.z * d);
        // Stand the arrowhead up, tipped forward, pointing along the trail
        m.rotation.set(-1.15, 0, 0);
        m.rotation.y = yaw;
        m.rotation.order = 'YXZ';
        const fade = Math.min(1, (len - 2 - d) / 4, d / 4);
        m.scale.setScalar(0.55 + 0.45 * Math.max(0, fade));
    });
}

// =====================================================================================
// Actions triggered by world objects
// =====================================================================================
actions.enterStage = (idx) => {
    if (P.stage === idx) return;
    setStage(idx);
    const s = STAGES[idx];
    showStageTitle(s.name, s.title, aliveClones() < s.rec ? 'Clones Recommended: ' + s.rec : '');
    sfx('whoosh'); sfx('gate');
    baseFov += reduceMotion ? 0 : 12;
    const fl = $('#flash'); fl.classList.remove('show', 'gate', 'eat'); void fl.offsetWidth; fl.classList.add('show', 'gate');
};
actions.pad = (idx, double) => {
    if (double && !S.passes.DoubleWins) { buy('pass', 'DoubleWins'); return; }
    sendMove(true);
    net.send('pad', { s: idx });
    // Remember how the run went for the Stage Clear card
    lastClear = { stage: idx, alive: aliveClones(), owned: S.owned };
    teleportLobby();
};
let lastClear = null;
actions.limit = (i) => {
    if (S.limits[i]) return;
    net.send('limit', { i });
};
actions.portal = (p) => net.send('portal', { stage: p.stage });
actions.openPanel = (kind) => openModal(kind);
actions.buy = (kind, key) => buy(kind, key);

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildRig(lookOf(p.kit, p.skin));
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.labelText = '';
        this.label = billboard([{ t: p.name, c: '#ffffff', s: '#16121f', px: 56 }], 6, 512, new V3(0, 7.6, 0), this.rig);
        this.crowd = new Crowd(lookOf(p.kit, p.skin), CFG.maxRemoteClones);
        this.crowd.reset(this.rig.position);
        this.phase = Math.random() * 6;
        this.av = null; this.blox = null; this.dead = false;
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        this.crowd.setLook(data, '');
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig;
        const k = 1 - Math.exp(-dt * 12);
        const tx = p.x, ty = p.y, tz = p.z;
        const jumped = (r.position.x - tx) ** 2 + (r.position.z - tz) ** 2 > 900;
        if (jumped) { r.position.set(tx, ty, tz); this.crowd.reset(r.position); }
        else { r.position.x += (tx - r.position.x) * k; r.position.y += (ty - r.position.y) * k; r.position.z += (tz - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        r.visible = p.anim !== 3;
        if (p.av !== this.av) this.setAvatar(p.av);
        if (this.blox) this.blox.update(dt, { moving: p.anim === 1, air: p.anim === 2, speed: CFG.walkSpeed, t });
        if (p.anim === 2) airPose(r);
        else { this.phase += dt * (p.anim === 1 ? 14 : 0); animRig(r, this.phase, p.anim === 1 ? 0.9 : 0); }
        const text = p.name + '|' + p.clones;
        if (text !== this.labelText) {
            this.labelText = text;
            this.label.userData.set([{ t: p.name, c: '#ffffff', s: '#16121f', px: 50 }, { t: p.clones + ' Clones', c: '#ffd028', s: '#16121f', px: 52 }]);
        }
        if (this.crowd.count() !== Math.min(p.clones, CFG.maxRemoteClones)) this.crowd.setCount(p.clones, r.position, false);
        this.crowd.update(dt, r.position, r.rotation.y, p.anim === 1, t, r.visible);
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        this.crowd.dispose();
        scene.remove(this.rig);
    }
}
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return 1;
    const seen = new Set();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            // Our own public stats come from the server
            const oldLevel = S.level;
            S.name = p.name; S.steps = p.steps; S.wins = p.wins; S.level = p.level; S.xp = p.xp; S.rebirths = p.rebirths;
            S.owned = p.owned; S.limit = p.limit;
            if (!rig || rig.userData.kit !== 0) { buildPlayer(0, 0); rig.userData.kit = 0; }
            if (oldLevel !== S.level) refreshModal();
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
    return room.state.players.size;
}

// =====================================================================================
// Networking
// =====================================================================================
// Hosted on Bloxity (VITE_BLOXITY_GAME_ID set at build time): the client is served from
// <id>.play.bloxity.io and the server pods are found through the Bloxity matchmaker.
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
// <id>.play.bloxity.io -> <id>.host.bloxity.io, <id>.dev.play.bloxity.io -> <id>.dev.host.bloxity.io
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);
async function serverEndpoint() {
    if (!BLOXITY_GAME_ID) return SERVER_URL;
    const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
    if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
    return (r && r.endpoint) || SERVER_URL;
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const running = P.moving || P.autoRun;
    const a = P.dead ? 3 : !P.onGround ? 2 : running ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a, mv: running ? 1 : 0 };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a + ',' + m.mv;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('sce_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('sce_uid', uid);
    }
    return uid;
}

async function connect(name) {
    const client = new Client(await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('clone', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bux = !!m.bux; net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(m.s === room.sessionId ? rig : remotes.get(m.s) && remotes.get(m.s).rig, m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    let firstProfile = true;
    room.onMessage('profile', (m) => {
        Object.assign(S, m);
        refreshWorld(); refreshModal();
        if (firstProfile) {
            firstProfile = false;
            if (!S.seenTutorial) showTutorial(() => net.send('tutorial'));
            else if (S.daily && S.daily.ready) setTimeout(() => toast('🎁 Daily reward ready! Open FREE', '#ffd028'), 2500);
        }
    });
    room.onMessage('toast', (m) => { if (/^You need /.test(m.text)) notice(m.text); else toast(m.text, m.color); });
    room.onMessage('levelUp', (m) => {
        levelUp(m.to, m.clones);
        sfx('levelUp'); rumble(0.3, 150);
        if (m.clones > 0) sfx('clone');
        ring(P.pos, 0x46ec50, 10, 0.8);
        sparkleColumn(P.pos, 0x7dff6b);
    });
    room.onMessage('gain', (m) => { popGain(m.n, m.t, m.gem); if (m.t) sfx('gain'); });
    room.onMessage('wins', (m) => {
        showWin(m.n);
        if (lastClear && lastClear.stage === m.stage) showClear(STAGES[m.stage], lastClear.alive, lastClear.owned, m.n);
        lastClear = null;
        floatText('+' + m.n + ' 🏆', '#ffd028', P.pos.clone().add(new V3(2.5, 5, 0)));
        sfx('cheer'); rumble(0.7, 500);
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        fireworks(P.pos, 6, () => sfx('firework'));
    });
    room.onMessage('limitUp', (m) => {
        bigText('+' + m.add + ' Clone Limit', '#ffffff');
        sfx('buy'); confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
    });
    room.onMessage('quest', (m) => {
        const r = m.reward;
        toast('✅ ' + m.text + ' ' + (r.wins ? '+' + r.wins + ' Wins' : '+' + r.steps.toLocaleString('en-US') + ' Steps'), '#7dff6b');
        sfx('buy');
    });
    room.onMessage('portalOk', (m) => {
        const idx = m.stage - 1;
        teleport(new V3(0, 0.5, STAGES[idx].zS + 8), 0);
        actions.enterStage(idx);
    });
    room.onMessage('revived', () => actions.revive(true));
    room.onMessage('fx', () => {
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        sparkleColumn(P.pos, 0xffd028);
        sfx('buy');
    });
    room.onMessage('boards', renderBoards);
    // The SDK retries dropped connections on its own; the server holds our place for 30 s
    room.onDrop(() => { $('#reconnecting').hidden = false; });
    room.onReconnect(() => { $('#reconnecting').hidden = true; toast('Reconnected!', '#7dff6b'); });
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        $('#reconnecting').hidden = true;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: Math.PI, pitch: 0.5, dist: 28, target: new V3() };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, running = false;

addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') { if (e.key === 'Enter') e.target.blur(); return; }
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) usePrompt();
    if (e.code === 'Escape') {
        if (!$('#modal').hidden) closeModal();
        else if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.25, 1.35);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2, 8, 50); e.preventDefault(); }, { passive: false });

if (isTouch) document.body.classList.add('touch');
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); touchJump = true; });
    jb.addEventListener('pointerup', () => { touchJump = false; });
    jb.addEventListener('pointercancel', () => { touchJump = false; });
})();

function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of solids) {
        let t0 = 0, t1 = best, hit = true;
        for (const a of ['x', 'y', 'z']) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3(), lookTmp = new V3();
const ATTRACT_LOOK = new V3(0, 8, 10);
let intro = null, baseFov = camera.fov;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function updateCamera(dt) {
    if (!running) {
        const t = performance.now() / 1000;
        camera.position.set(Math.sin(t * 0.08) * 55, 22, Math.cos(t * 0.08) * 45 - 5);
        camera.lookAt(ATTRACT_LOOK);
        baseFov = camera.fov;
        return;
    }
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 4.5, P.pos.z), 1 - Math.exp(-dt * 18));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const dist = Math.max(3, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camPos.copy(cam.target).addScaledVector(camDir, dist);
    if (intro) {
        intro.t += dt;
        const k = ease(Math.min(1, intro.t / intro.dur));
        camera.position.lerpVectors(intro.from, camPos, k);
        camera.lookAt(lookTmp.lerpVectors(ATTRACT_LOOK, cam.target, k));
        if (intro.t >= intro.dur) intro = null;
    } else {
        camera.position.copy(camPos);
        camera.lookAt(cam.target);
    }
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    const want = innerWidth < innerHeight ? 85 : 70;
    baseFov += (want - baseFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    sun.position.set(P.pos.x + 40, P.pos.y + 90, P.pos.z - 30);
    sun.target.position.copy(P.pos);
}

// Proximity prompts
let activePrompt = null;
const projV = new V3();
const promptKey = promptEl.querySelector('kbd');
const usingPad = () => pad.connected && performance.now() - pad.lastUsed < 8000;
function updatePrompt() {
    let best = null, bd = Infinity;
    if (!P.dead) for (const p of prompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    promptEl.style.left = ((projV.x + 1) / 2 * innerWidth) + 'px';
    promptEl.style.top = ((1 - projV.y) / 2 * innerHeight) + 'px';
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
    const key = usingPad() ? 'X' : 'E';
    if (promptKey.textContent !== key) promptKey.textContent = key;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);

// Controller buttons: popups and panels first, then gameplay shortcuts
const shown = (sel) => { const e = $(sel); return !!e && !e.hidden; };
function focusStep(container, dir) {
    const items = [...container.querySelectorAll('button:not(:disabled), input[type=range]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView({ block: 'nearest' });
}
function padButtons() {
    const p = pad.pressed;
    if (!p.size) return;
    const overlay = ['#start', '#offline', '#buy', '#revive', '#modal'].find(shown);
    if (overlay) pad.jump = false;
    if (overlay === '#start') { if ((p.has('A') || p.has('START')) && shown('#playBtn')) play(); return; }
    if (overlay === '#offline') { if (p.has('A')) $('#reconnectBtn').click(); return; }
    if (overlay === '#buy') { if (p.has('A')) $('#buyOk').click(); else if (p.has('B')) $('#buyCancel').click(); return; }
    if (overlay === '#revive') { if (p.has('A')) $('#reviveYes').click(); else if (p.has('B')) $('#reviveNo').click(); return; }
    if (overlay === '#modal') {
        const body = $('#modal');
        const el = document.activeElement;
        const onSlider = el && el.type === 'range' && body.contains(el);
        if (onSlider && (p.has('LEFT') || p.has('RIGHT'))) {
            el.value = Number(el.value) + (p.has('RIGHT') ? 5 : -5);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        if (p.has('DOWN') || p.has('RIGHT')) focusStep(body, 1);
        else if (p.has('UP') || p.has('LEFT')) focusStep(body, -1);
        else if (p.has('A') && el && body.contains(el) && el.tagName === 'BUTTON') el.click();
        else if (['B', 'Y', 'LB', 'BACK', 'START'].some((b) => p.has(b))) { closeModal(); canvas.focus(); }
        return;
    }
    if (!running) return;
    if (shown('#tutorial') && p.has('A')) { $('#tutPlay').click(); return; }
    if (p.has('X')) usePrompt();
    if (p.has('Y')) openModal('store');
    if (p.has('LB')) openModal('rebirth');
    if (p.has('BACK')) openModal('free');
    if (p.has('START')) openModal('settings');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 8, 50);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 8, 50);
    if (['Y', 'LB', 'BACK', 'START'].some((b) => p.has(b))) focusStep($('#modal'), 1);
}
onGamepadConnection((g, on) => {
    if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c');
});

// =====================================================================================
// Main update
// =====================================================================================
let clockT = 0, hudT = 0, online = 1;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();

function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = 0, r = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.25, 1.35);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (P.dead) mv.set(0, 0, 0);
    P.moving = mv.lengthSq() > 0.01;

    if (!P.dead) {
        if ((keys.Space || touchJump || pad.jump) && P.onGround) {
            P.vel.y = JUMP_V; P.onGround = false;
            sfx('jump'); P.squashV += 5; dust(P.pos, 4, 0.6);
        }
        P.vel.y -= GRAV * dt;
        P.knock.multiplyScalar(Math.exp(-(P.onGround ? 5 : 1.5) * dt));
        const vx = mv.x * CFG.walkSpeed + P.knock.x, vz = mv.z * CFG.walkSpeed + P.knock.z;
        const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
        const n = Math.max(1, Math.ceil(dist / 0.6));
        const sdt = dt / n;
        const wasGround = P.ground;
        P.onGround = false; P.ground = null;
        for (let i = 0; i < n; i++) {
            moveAxis('x', vx * sdt);
            moveAxis('z', vz * sdt);
            moveAxis('y', P.vel.y * sdt);
        }
        if (!P.onGround && wasGround && P.vel.y <= 0 && P.vel.y > -40) {
            // Stick to the ground when walking down small steps
            const y0 = P.pos.y;
            moveAxis('y', -0.3);
            if (!P.onGround) P.pos.y = y0;
        }
        if (P.onGround) {
            if (P.airTime > 0.3) {
                sfx('land');
                dust(P.pos, P.airTime > 0.7 ? 12 : 7, P.airTime > 0.7 ? 1.4 : 1);
                P.squashV -= Math.min(9, 3 + P.airTime * 6);
            }
            P.airTime = 0;
        } else P.airTime += dt;
        if (P.moving) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));

        if (P.shield > 0) P.shield -= dt;
        if (P.pos.y < CFG.voidY) { if (P.stage >= 0) lavaFall(); else { P.shield = 0; die(); } }
        for (const k of kills) {
            if (!k.active) continue;
            if (k.max.x > P.pos.x - HW + 0.2 && k.min.x < P.pos.x + HW - 0.2 && k.max.y > P.pos.y + 0.1 && k.min.y < P.pos.y + PH && k.max.z > P.pos.z - HW + 0.2 && k.min.z < P.pos.z + HW - 0.2) {
                if (k.lava) lavaFall(); else die();
                break;
            }
        }
        P.safeTimer -= dt;
        // Safe spots are solid ground near the middle of what you stand on (so a lava respawn is not on an edge)
        if (P.onGround && P.safeTimer <= 0 && P.ground && P.pos.x > P.ground.min.x + 2 && P.pos.x < P.ground.max.x - 2) { P.lastSafe.copy(P.pos); P.safeTimer = 0.3; }

        for (const tr of triggers) {
            const inside = overlapsBox(tr, P.pos.x, P.pos.y, P.pos.z);
            if (inside && !tr.inside && tr.enter) tr.enter();
            tr.inside = inside;
            if (P.dead) break;
        }
        // Which stage corridor we are in (also after teleports and portals)
        const st = stageAt(P.pos.z);
        if (st !== P.stage) { if (st >= 0) actions.enterStage(st); else setStage(-1); }
        // Back in the lobby: the run is over and eaten clones return
        if (P.stage === -1 && P.lost > 0 && P.pos.z < LOBBY.halfZ - 1) P.lost = 0;

        // AUTO RUN treadmills: standing on an unlocked one runs for you
        const tread = P.onGround && P.ground && P.ground.tread;
        P.autoRun = !!tread && !treadLocked(tread);
        if (tread && treadLocked(tread) && t - P.lockToastT > 4) {
            P.lockToastT = t;
            buy('pass', tread.pass);
        }
    } else P.autoRun = false;

    updateMonsters(dt, t);
    updateStages(dt, t, P.stage, stageCtx);
    updateStageBar(P.stage, P.pos.z, P.stage >= 0 ? bossZ(P.stage) : null);
    updateGuide(dt);
    updateEffects(dt);
    updateFx(dt);
    updateScreens(t);
    for (const fn of tickers) fn(dt, t);
    beltTex.offset.y = (beltTex.offset.y + dt * 0.9) % 1;

    online = syncRemotes(dt, t);

    // Clone count follows the server (levels, limit, pass) minus the clones eaten on this run
    if (myCrowd) {
        const want = Math.min(aliveClones(), myCrowd.max);
        if (myCrowd.count() !== want) myCrowd.setCount(want, P.pos, myCrowd.count() < want);
    }

    rig.position.copy(P.pos);
    rig.rotation.y = P.facing;
    const runAnim = (P.moving || P.autoRun) && P.onGround;
    P.animPhase += dt * (P.onGround ? (runAnim ? 14 : 4) : 0);
    if (P.onGround) animRig(rig, P.animPhase, runAnim ? 0.9 : 0); else airPose(rig);
    if (localAvatar) localAvatar.update(dt, { moving: runAnim, air: !P.onGround, speed: CFG.walkSpeed, t });
    const stepN = Math.floor(P.animPhase / Math.PI);
    if (runAnim && !P.dead && stepN !== P.lastStep) sfx('step');
    P.lastStep = stepN;
    // Squash & stretch spring around 1
    P.squashV += (1 - P.squash) * 180 * dt;
    P.squashV *= Math.exp(-12 * dt);
    P.squash = clamp(P.squash + P.squashV * dt, 0.7, 1.3);
    rig.scale.set(1 / Math.sqrt(P.squash), P.squash, 1 / Math.sqrt(P.squash));
    setSpeedLines(0, dt);
    rig.visible = !P.dead && (P.shield <= 0 || Math.floor(t * 12) % 2 === 0);
    if (myCrowd) myCrowd.update(dt, P.pos, P.facing, runAnim, t, !P.dead);

    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(P, online, aliveClones()); refreshWorld(); }
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) {
        // First frame after setup: apply portal settings and lift the Bloxity loading overlay
        loadingSignaled = true;
        BX.triggerAllSettings();
    }
    pollGamepad();
    padButtons();
    if (running) update(dt);
    else { beltTex.offset.y = (beltTex.offset.y + dt * 0.9) % 1; updateScreens(now / 1000); }
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}

// Straight into the game: no menu. Joins with the Bloxity name (or guest name) automatically.
let joining = false;
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    $('#loading').textContent = 'Joining…';
    BX.loadingStep('Joining a server…');
    initAudio();
    try {
        await waitForLogin(1500);
        const saved = (storageGet('sce_name') || '').slice(0, 20);
        const room = await connect(BX.identity().loggedIn ? '' : saved);
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    intro = { t: 0, dur: 2.2, from: camera.position.clone() };
    running = true;
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleportLobby();
    showTips();
    canvas.focus();
    BX.loadingEnd();
}
// Embedded games get the Bloxity user from the portal handshake a moment after init
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
// Controls reminder for the first seconds of play
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? k('L', 'Move') + k('A', 'Jump') + k('X', 'Interact') + k('R', 'Camera')
        : isTouch
            ? '<span>Joystick to move · JUMP · drag to look</span>'
            : k('WASD', 'Move') + k('Space', 'Jump') + k('E', 'Interact') + k('Drag', 'Camera') + k('Wheel', 'Zoom');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 9000);
    setTimeout(() => { el.hidden = true; }, 9900);
}
// Browsers only start audio after a user gesture
function unlockAudioOnGesture() {
    const unlock = () => { initAudio(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); removeEventListener('touchstart', unlock); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); addEventListener('touchstart', unlock);
}

// Portal settings only apply when the game runs inside bloxity.io (standalone has its own panel)
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => clamp((parseInt(v, 10) || 0) / 100, 0, 1);
    BX.listenSetting('master_volume', embedded((v) => setVolume('master', pct(v))));
    BX.listenSetting('music_volume', embedded((v) => setVolume('music', pct(v))));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high')));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (P.dead) actions.revive(false); else if (running) teleportLobby(); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}
// Account chip in the HUD
function showIdentity(id) {
    const avail = BX.bloxity.ready;
    $('#acct').hidden = !avail;
    if (!avail) return;
    $('#acctName').textContent = id.name || 'Guest';
    $('#acctBtn').textContent = id.loggedIn ? 'Log out' : 'Log in';
    const pfp = $('#acctPfp');
    pfp.hidden = !id.pfp;
    if (id.pfp) pfp.src = id.pfp;
}
function toggleLogin() { if (BX.identity().loggedIn) BX.logout(); else BX.login(); }

async function boot() {
    BX.initBloxity();
    BX.loadingStep('Loading fonts…');
    try { await Promise.race([document.fonts.load('700 40px Fredoka'), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    BX.loadingStep('Building the lobby…');
    buildWorld();
    const batched = mergeStatic();
    if (import.meta.env.DEV) console.info("[world] batched", batched.before, "boxes into", batched.after, "meshes");
    loadBase().catch(() => {}); // warm up the Bloxity body model
    wirePortalSettings();
    wirePortalEvents();
    BX.loadCatalogPrices().then((changed) => { if (changed) refreshWorld(); });
    BX.onIdentity((id) => {
        showIdentity(id);
        // Logged in after joining: move this session onto the Bloxity profile
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    $('#acctBtn').addEventListener('click', toggleLogin);
    $('#acctPfp').addEventListener('error', (e) => { e.target.hidden = true; });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV) {
    window.__qa = {
        P, S, STAGES, avatarStats, scene, cam,
        teleport: (x, y, z) => teleport(new V3(x, y, z), 0),
        monsters: () => activeMonsters().map((m) => ({ state: m.state, x: m.pos.x, z: m.pos.z })),
        crowd: () => (myCrowd ? myCrowd.count() : 0),
        state: () => ({ x: P.pos.x, y: P.pos.y, z: P.pos.z, dead: P.dead, stage: P.stage, wins: S.wins, level: S.level, steps: S.steps, owned: S.owned, alive: aliveClones(), limit: S.limit, rebirths: S.rebirths }),
    };
}
