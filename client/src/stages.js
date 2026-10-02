// Premium stage themes: floors, set dressing, hazards, Step gems and per-stage ambience.
// world.js builds the shared corridor shell (walls, ceiling, end zone); this module fills it.
// Hazards are local to each player (like the monsters) and report hits back to main.js.
import { T, V3, scene, mat, box, aabb, UNIT, solids, kills, texFrom, billboard, camera, buildMonster } from './engine.js';
import { brickFloorMaterial, studFloorMaterial } from './textures.js';
import { bubble } from './fx.js';
import { CFG, STAGES, rngFrom, clamp } from '../../shared/config.js';

const W = CFG.courseWidth, HALF = W / 2, CH = CFG.wallHeight;

// Look of each theme: wall / ceiling colours, ceiling light colour, floor kind
export const THEMES = {
    hall: { wall: 0x6f689a, ceil: 0x4a4470, light: 0xffe7a8, floor: 'brick' },
    shadow: { wall: 0x8d88c8, ceil: 0x3a3466, light: 0xffffff, floor: 'studs' },
    lava: { wall: 0x7a3a34, ceil: 0x24100c, light: 0xffa040, floor: 'lava' },
    spin: { wall: 0x3a8aa8, ceil: 0x123040, light: 0x6fe0ff, floor: 'studs', tint: 0x9fe6ff },
    laser: { wall: 0x2e2c66, ceil: 0x0e0e26, light: 0xff3a5a, floor: 'grid' },
    boss: { wall: 0x5a1a24, ceil: 0x1e0608, light: 0xff4a3a, floor: 'brick' },
};

function tbox(sx, sy, sz, x, y, z, material, solid) {
    const m = new T.Mesh(UNIT, material);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    scene.add(m);
    if (solid) solids.push(aabb(x, y, z, sx, sy, sz));
    return m;
}

// ----- textures -----
function canvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
}
const lavaTex = (() => {
    const c = canvas(256, 256, (x) => {
        x.fillStyle = '#e8420c'; x.fillRect(0, 0, 256, 256);
        let s = 9;
        const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        for (let i = 0; i < 70; i++) {
            const cx = r() * 256, cy = r() * 256, rad = 10 + r() * 34;
            for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
                const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
                g.addColorStop(0, i % 3 ? 'rgba(255,220,80,0.9)' : 'rgba(255,250,190,0.95)');
                g.addColorStop(0.6, 'rgba(255,140,20,0.45)');
                g.addColorStop(1, 'rgba(200,40,0,0)');
                x.fillStyle = g; x.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
            }
        }
        x.strokeStyle = 'rgba(90,16,0,0.55)'; x.lineWidth = 3;
        for (let i = 0; i < 26; i++) {
            x.beginPath(); let px = r() * 256, py = r() * 256; x.moveTo(px, py);
            for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 50; py += (r() - 0.5) * 50; x.lineTo(px, py); }
            x.stroke();
        }
    });
    const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
})();
const gridTex = (() => {
    const c = canvas(128, 128, (x) => {
        x.fillStyle = '#0d0c26'; x.fillRect(0, 0, 128, 128);
        x.strokeStyle = '#2a2a6a'; x.lineWidth = 2;
        for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
        x.strokeStyle = '#3fd8ff'; x.lineWidth = 3;
        x.strokeRect(1.5, 1.5, 125, 125);
    });
    const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
})();
// Yellow/black hazard stripes for the spinning arms
const stripeTex = (() => {
    const c = canvas(64, 16, (x) => {
        x.fillStyle = '#ffd028'; x.fillRect(0, 0, 64, 16);
        x.fillStyle = '#16121f';
        for (let i = -16; i < 80; i += 16) { x.beginPath(); x.moveTo(i, 16); x.lineTo(i + 8, 16); x.lineTo(i + 16, 0); x.lineTo(i + 8, 0); x.fill(); }
    });
    const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(6, 1);
    return t;
})();

// ----- per-stage runtime state -----
// rt[i] = { hazards: [...], gems: [...], update(dt, t, ctx), flicker: [...] }
const rt = [];
const lavaMats = [];

function floorFor(i, s, theme) {
    const len = s.len, mid = s.zS + len / 2;
    if (theme.floor === 'lava') return; // the lava stage lays its own bridge
    let m;
    if (theme.floor === 'studs') m = studFloorMaterial(W / 4, len / 4, theme.tint);
    else if (theme.floor === 'grid') {
        const t = gridTex.clone(); t.needsUpdate = true; t.repeat.set(W / 8, len / 8);
        m = new T.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.55 });
    } else m = brickFloorMaterial(W / 8, len / 8);
    tbox(W, 2, len, 0, -1, mid, m, true);
}

// ----- shared decorations -----
function hangingLamp(x, z, color) {
    box(0.25, 5, 0.25, x, CH - 2.5, z, 0x16121f, { decor: true });
    const shade = new T.Mesh(new T.ConeGeometry(1.6, 1.4, 12, 1, true), mat(0x2b2546));
    shade.position.set(x, CH - 5.4, z); scene.add(shade);
    const bulb = new T.Mesh(new T.SphereGeometry(0.6, 12, 8), mat(color, { neon: true }));
    bulb.position.set(x, CH - 6, z); scene.add(bulb);
    // Soft light cone on the floor
    const pool = new T.Mesh(new T.CircleGeometry(5, 32), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.04, z); scene.add(pool);
}
function banner(z, side, text, bg) {
    const c = canvas(128, 320, (g) => {
        g.fillStyle = bg; g.fillRect(0, 0, 128, 300);
        g.beginPath(); g.moveTo(0, 300); g.lineTo(64, 320); g.lineTo(128, 300); g.fill();
        g.strokeStyle = '#ffd028'; g.lineWidth = 6; g.strokeRect(8, 8, 112, 284);
        g.font = '700 46px Fredoka, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffffff';
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.45)';
        [...text].forEach((ch, i) => { g.strokeText(ch, 64, 60 + i * 50); g.fillText(ch, 64, 60 + i * 50); });
    });
    const m = new T.Mesh(new T.PlaneGeometry(4.5, 11), new T.MeshLambertMaterial({ map: texFrom(c), transparent: true, side: T.DoubleSide }));
    m.position.set(side * (HALF - 0.1), CH - 9, z); m.rotation.y = -side * Math.PI / 2; scene.add(m);
    return m;
}

// ----- Step gems -----
const GEM_GEO = new T.OctahedronGeometry(1, 0);
function addGem(list, i, x, y, z) {
    const g = new T.Group();
    const core = new T.Mesh(GEM_GEO, mat(0x5ff0ff, { neon: true })); core.scale.set(0.9, 1.3, 0.9); g.add(core);
    const shell = new T.Mesh(GEM_GEO, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
    shell.scale.set(1.3, 1.8, 1.3); g.add(shell);
    g.position.set(x, y + 2.2, z);
    scene.add(g);
    list.push({ id: String(list.length), g, base: y + 2.2, respawnAt: 0, phase: Math.random() * 6 });
}

// =====================================================================================
// Theme builders. Each returns { hazards, update } for its stage.
// =====================================================================================
function buildHall(i, s, rng, R) {
    for (let z = s.zS + 22; z < s.cE; z += 26) hangingLamp(0, z, 0xffe7a8);
    for (let z = s.zS + 30; z < s.cE - 10; z += 52) { banner(z, -1, 'RUN!', '#d71e2d'); banner(z + 26, 1, 'GO!', '#1e46c8'); }
    // A friendly gem trail that teaches the route
    for (let z = s.zS + 24; z < s.cE - 6; z += 14) addGem(R.gems, i, Math.sin(z * 0.08) * 8, 0, z);
    // Floating dust motes catching the lamp light
    R.update = (dt, t) => {
        if (Math.abs(camera.position.z - (s.zS + s.len / 2)) > s.len) return;
        if (Math.random() < dt * 6) bubble(new V3((Math.random() * 2 - 1) * HALF, Math.random() * 4, camera.position.z + 10 + Math.random() * 40), 0xffe7a8);
    };
}

function buildShadow(i, s, rng, R) {
    // Ceiling lights that flicker; red alarm strips glow while monsters attack
    const flick = new T.MeshBasicMaterial({ color: 0xffffff });
    for (let z = s.zS + 10; z < s.zE; z += 20) for (const sx of [-1, 1]) {
        const l = new T.Mesh(UNIT, flick); l.scale.set(0.6, 0.3, 8); l.position.set(sx * 8, CH - 0.4, z); l.rotation.y = sx * 0.5; scene.add(l);
    }
    const alarm = new T.MeshBasicMaterial({ color: 0x400008 });
    for (const sx of [-1, 1]) { const a = new T.Mesh(UNIT, alarm); a.scale.set(0.3, 0.6, s.len - 8); a.position.set(sx * (HALF - 0.1), 1.2, s.zS + s.len / 2); scene.add(a); }
    for (let z = s.zS + 24; z < s.cE - 40; z += 18) addGem(R.gems, i, (rng() * 2 - 1) * (HALF - 6), 0, z);
    R.update = (dt, t, ctx) => {
        const on = Math.sin(t * 23) + Math.sin(t * 7.3) > -1.6;
        flick.color.setScalar(on ? 1.15 : 0.25);
        alarm.color.setRGB(ctx.alert ? 0.9 + Math.sin(t * 12) * 0.4 : 0.25, 0.02, ctx.alert ? 0.08 : 0.03);
    };
}

function buildLava(i, s, rng, R) {
    const lavaM = new T.MeshBasicMaterial({ map: lavaTex.clone() });
    lavaM.map.needsUpdate = true; lavaM.map.repeat.set(W / 16, s.len / 16);
    lavaMats.push(lavaM);
    const mid = s.zS + s.len / 2;
    tbox(W, 1, s.len, 0, -3.5, mid, lavaM, false);
    const k = aabb(0, -7, mid, W, 12.8, s.len); k.active = true; k.lava = true; kills.push(k);
    // Solid ground at the entrance and before the monsters / end zone
    const zA = s.zS + 22, zB = s.cE - 34;
    const rock = brickFloorMaterial(W / 8, 22 / 8);
    tbox(W, 2, zA - s.zS, 0, -1, (s.zS + zA) / 2, rock, true);
    tbox(W, 2, s.zE - zB, 0, -1, (zB + s.zE) / 2, brickFloorMaterial(W / 8, (s.zE - zB) / 8), true);
    // Winding bridge of offset slabs
    const xs = [0, -8, 0, 8, 0, -7, 6, 0, -8, 4];
    const segs = [];
    let z = zA, n = 0;
    while (z < zB) {
        const zl = Math.min(24, zB - z), x = xs[n % xs.length];
        tbox(14, 2, zl + 0.2, x, -1, z + zl / 2, brickFloorMaterial(14 / 8, zl / 8), true);
        // Glowing edge trim so the bridge reads against the lava
        for (const sx of [-1, 1]) box(0.4, 0.3, zl, x + sx * 6.9, 0.1, z + zl / 2, 0xffb040, { neon: true, decor: true });
        segs.push({ z0: z, z1: z + zl, x });
        z += zl; n++;
    }
    s.pathX = (pz) => { for (const g of segs) if (pz >= g.z0 && pz < g.z1) return g.x; return 0; };
    // Orange glow strips at the base of the walls
    for (const sx of [-1, 1]) box(0.3, 1.4, s.len, sx * (HALF - 0.1), 0.6, mid, 0xff6a14, { neon: true, decor: true });
    // Geysers: warn ring, then a column of lava
    segs.forEach((g, gi) => {
        if (gi === 0) return;
        const gx = g.x + (gi % 2 ? -3 : 3), gz = (g.z0 + g.z1) / 2;
        const ring = new T.Mesh(new T.RingGeometry(0.6, 3, 32), new T.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(gx, 0.08, gz); scene.add(ring);
        const col = new T.Mesh(new T.CylinderGeometry(2.4, 3, 1, 20, 1, true), new T.MeshBasicMaterial({ color: new T.Color(0xffa020).multiplyScalar(1.4), transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
        col.position.set(gx, 0, gz); col.visible = false; scene.add(col);
        const period = 3.2, phase = gi * 1.13;
        R.hazards.push({
            at: new V3(gx, 2, gz), on: false,
            update(dt, t) {
                const k2 = ((t + phase) % period) / period;
                const warn = k2 > 0.45 && k2 < 0.7, erupt = k2 >= 0.7 && k2 < 0.92;
                ring.material.opacity = warn ? 0.35 + 0.35 * Math.sin(t * 30) : erupt ? 0.6 : 0;
                ring.scale.setScalar(warn ? 0.6 + (k2 - 0.45) * 1.6 : 1);
                this.on = erupt;
                col.visible = erupt;
                if (erupt) {
                    const h = 14 * Math.min(1, (k2 - 0.7) * 14);
                    col.scale.set(1, h, 1); col.position.y = h / 2;
                    if (Math.random() < dt * 30) bubble(new V3(gx, h, gz), 0xffc040);
                }
            },
            hits(p) { return this.on && (p.x - gx) ** 2 + (p.z - gz) ** 2 < 7.5 && p.y < 14; },
        });
    });
    for (const g of segs) addGem(R.gems, i, g.x + (rng() < 0.5 ? -4 : 4), 0, (g.z0 + g.z1) / 2 + 6);
    R.update = (dt, t) => {
        lavaM.map.offset.y = (lavaM.map.offset.y + dt * 0.03) % 1;
        lavaM.map.offset.x = Math.sin(t * 0.3) * 0.05;
        if (Math.abs(camera.position.z - mid) < s.len && Math.random() < dt * 14) {
            bubble(new V3((Math.random() * 2 - 1) * HALF, -2, camera.position.z + 5 + Math.random() * 45), Math.random() < 0.5 ? 0xff8a20 : 0xffd040);
        }
    };
}

function buildSpin(i, s, rng, R) {
    const armMat = new T.MeshLambertMaterial({ map: stripeTex });
    const spikeMat = mat(0xd8dce8);
    const L = HALF - 0.6;
    let n = 0;
    for (let z = s.zS + 40; z < s.cE - 40; z += 34, n++) {
        const dir = n % 2 ? -1 : 1, speed = 1.3 + n * 0.12;
        box(2.6, 3.4, 2.6, 0, 1.7, z, 0x16121f, { cast: true });
        const cap = new T.Mesh(new T.TorusGeometry(1.8, 0.3, 8, 24), mat(0x6fe0ff, { neon: true }));
        cap.rotation.x = Math.PI / 2; cap.position.set(0, 3.5, z); scene.add(cap);
        const arm = new T.Group(); arm.position.set(0, 1.2, z); scene.add(arm);
        const bar = new T.Mesh(UNIT, armMat); bar.scale.set(L * 2, 1.2, 1.2); bar.castShadow = true; arm.add(bar);
        for (let k = -6; k <= 6; k++) {
            if (Math.abs(k) < 1) continue;
            const sp = new T.Mesh(new T.ConeGeometry(0.35, 1, 6), spikeMat);
            sp.position.set(k * (L / 6.5), 0, 0.85); sp.rotation.x = Math.PI / 2; arm.add(sp);
        }
        const ph = rng() * Math.PI;
        R.hazards.push({
            at: new V3(0, 1.2, z), ang: ph,
            update(dt) { this.ang += dt * speed * dir; arm.rotation.y = this.ang; },
            hits(p) {
                if (p.y > 1.7) return false; // jumped over
                const c = Math.cos(this.ang), sn = Math.sin(this.ang);
                const dx = p.x, dz = p.z - z;
                // distance from the player to the bar (a segment through the pillar)
                const along = clamp(dx * c - dz * sn, -L, L);
                const ex = dx - along * c, ez = dz + along * sn;
                if (ex * ex + ez * ez < 1.8 * 1.8) { this.at.set(along * c, 1.2, z - along * sn); return true; }
                return false;
            },
        });
        addGem(R.gems, i, (n % 2 ? -1 : 1) * 10, 0, z + 17);
    }
    // Neon rings along the walls
    for (let z = s.zS + 20; z < s.zE; z += 30) for (const sx of [-1, 1]) box(0.3, 8, 0.6, sx * (HALF - 0.1), 6, z, 0x3fd8ff, { neon: true, decor: true });
}

function buildLaser(i, s, rng, R) {
    const beamMat = new T.MeshBasicMaterial({ color: new T.Color(0xff2a4a).multiplyScalar(1.5), transparent: true, opacity: 0.9 });
    const warnMat = new T.MeshBasicMaterial({ color: 0xff8090, transparent: true, opacity: 0.25 });
    let n = 0;
    for (let z = s.zS + 36; z < s.cE - 40; z += 28, n++) {
        // Emitter posts on both walls
        for (const sx of [-1, 1]) box(1.2, 8.6, 1.2, sx * (HALF - 0.6), 4.3, z, 0x2b2546, { decor: true });
        const beams = [];
        for (const y of [0.9, 2.6, 4.3, 6, 7.6]) {
            const b = new T.Mesh(UNIT, beamMat); b.scale.set(W - 2.4, 0.18, 0.18); b.position.set(0, y, z); scene.add(b);
            beams.push(b);
        }
        const moving = n % 2 === 0;
        const gap = 10, phase = rng() * 6, sp = 0.7 + n * 0.08;
        if (moving) {
            // A wall of beams with a gap that slides left and right
            const parts = [[], []];
            for (const b of beams) {
                scene.remove(b);
                for (const side of [0, 1]) { const m = new T.Mesh(UNIT, beamMat); m.position.set(0, b.position.y, z); scene.add(m); parts[side].push(m); }
            }
            R.hazards.push({
                at: new V3(0, 3, z), gx: 0,
                update(dt, t) {
                    this.gx = Math.sin(t * sp + phase) * (HALF - gap / 2 - 1.5);
                    const lw = this.gx - gap / 2 + HALF - 1.2, rw = HALF - 1.2 - (this.gx + gap / 2);
                    for (const m of parts[0]) { m.scale.set(Math.max(0.01, lw), 0.18, 0.18); m.position.x = -HALF + 1.2 + lw / 2; }
                    for (const m of parts[1]) { m.scale.set(Math.max(0.01, rw), 0.18, 0.18); m.position.x = HALF - 1.2 - rw / 2; }
                },
                hits(p) {
                    if (Math.abs(p.z - z) > 0.9 || p.y > 7.8) return false;
                    if (Math.abs(p.x - this.gx) < gap / 2 - 0.6) return false;
                    this.at.set(p.x, 3, z); return true;
                },
            });
        } else {
            // A full wall that blinks off long enough to run through
            R.hazards.push({
                at: new V3(0, 3, z), on: true,
                update(dt, t) {
                    const k2 = ((t + phase) % 3) / 3;
                    this.on = k2 < 0.5;
                    const warn = k2 > 0.85;
                    for (const b of beams) { b.visible = this.on || (warn && Math.sin(t * 40) > 0); b.material = this.on ? beamMat : warnMat; }
                },
                hits(p) {
                    if (!this.on || Math.abs(p.z - z) > 0.9 || p.y > 7.8) return false;
                    this.at.set(p.x, 3, z); return true;
                },
            });
        }
        addGem(R.gems, i, (rng() * 2 - 1) * 10, 0, z + 14);
    }
    for (const sx of [-1, 1]) box(0.3, 0.3, s.len, sx * (HALF - 0.1), CH - 3, s.zS + s.len / 2, 0xff2a4a, { neon: true, decor: true });
}

function buildBoss(i, s, rng, R) {
    // Rotating red alarm beacons along the walls
    const beacons = [];
    for (let z = s.zS + 20; z < s.zE; z += 40) for (const sx of [-1, 1]) {
        const g = new T.Group(); g.position.set(sx * (HALF - 1), CH - 4, z); scene.add(g);
        const dome = new T.Mesh(new T.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff2a2a, { neon: true }));
        g.add(dome);
        const beam = new T.Mesh(new T.ConeGeometry(3, 12, 16, 1, true), new T.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide }));
        beam.rotation.z = Math.PI / 2; beam.position.x = 6; const pivot = new T.Group(); pivot.add(beam); g.add(pivot);
        beacons.push(pivot);
    }
    for (let z = s.zS + 30; z < s.cE - 10; z += 22) addGem(R.gems, i, (rng() * 2 - 1) * (HALF - 6), 0, z);
    // The boss: a giant shadow monster that chases you down the hall
    const boss = buildMonster();
    boss.scale.setScalar(4.2); boss.visible = false; scene.add(boss);
    const tag = billboard([{ t: '☠ THE BOSS ☠', c: '#ff4a4a', s: '#16121f', px: 70 }], 14, 512, new V3(0, 24, 0));
    tag.visible = false;
    const B = { z: s.zS - 6, x: 0, active: false, pause: 0, chomp: 0 };
    R.boss = B;
    R.reset = () => { B.active = false; B.z = s.zS - 6; boss.visible = false; tag.visible = false; };
    R.update = (dt, t, ctx) => {
        for (const b of beacons) b.rotation.y += dt * 3;
        if (!ctx.inStage || ctx.dead) { if (B.active) R.reset(); return; }
        if (!B.active && ctx.player.z > s.zS + 64) { B.active = true; B.z = s.zS - 4; boss.visible = true; tag.visible = true; ctx.roar(); }
        if (!B.active) return;
        if (B.pause > 0) B.pause -= dt;
        else {
            const lead = ctx.player.z - B.z;
            // Steady pace with a rubber band so it never falls far behind
            const sp = 20 + Math.max(0, lead - 44) * 0.6;
            B.z = Math.min(s.cE - 10, B.z + sp * dt);
            B.x += (clamp(ctx.player.x, -HALF + 8, HALF - 8) - B.x) * Math.min(1, dt * 1.5);
        }
        B.chomp = Math.max(0, B.chomp - dt * 2);
        const u = boss.userData;
        boss.position.set(B.x, 12 + Math.sin(t * 2.5) * 0.8, B.z);
        boss.rotation.y = 0;
        u.body.rotation.x = 0.25;
        u.jaw.position.y = -0.6 - 0.5 - Math.abs(Math.sin(t * 6)) * 0.7 + B.chomp;
        tag.position.set(B.x, 26, B.z);
        if (B.z >= s.cE - 10 || ctx.player.z >= s.cE) return; // the end zone is safe
        // It eats the clones trailing behind you first
        const front = B.z + 9;
        if (B.pause <= 0) {
            const i2 = ctx.crowdBehind(front);
            if (i2 >= 0) { B.pause = 0.45; B.chomp = 1; ctx.eatMember(i2, new V3(B.x, 3, front)); }
            else if (ctx.player.z < front && Math.abs(ctx.player.x - B.x) < 14) { B.pause = 1; B.chomp = 1; ctx.hitPlayer(new V3(B.x, 3, front), true); }
        }
        if (camera.position.distanceTo(boss.position) < 60) ctx.shake(dt * 0.6);
    };
}

const BUILDERS = { hall: buildHall, shadow: buildShadow, lava: buildLava, spin: buildSpin, laser: buildLaser, boss: buildBoss };

// Called by world.js for each stage after the shell is built
export function buildStageTheme(i, s) {
    const theme = THEMES[s.theme] || THEMES.hall;
    const R = { hazards: [], gems: [], update: null, reset: null };
    rt[i] = R;
    floorFor(i, s, theme);
    (BUILDERS[s.theme] || buildHall)(i, s, rngFrom(900 + i * 41), R);
}

// ----- runtime -----
const fogTarget = new T.Color(0x2a2440), LOBBY_FOG = new T.Color(0x2a2440);
// z of the chasing boss in stage i, or null when it is not out
export function bossZ(i) { const R = rt[i]; return R && R.boss && R.boss.active ? R.boss.z : null; }
export function stageReset(i) { const R = rt[i]; if (R && R.reset) R.reset(); }
// ctx: { player, dead, shield, inStage, alert, crowdBehind(z), eatMember(i, at), hitPlayer(at), roar(), shake(a), gem(stage, id) }
export function updateStages(dt, t, cur, ctx) {
    // Fog and background fade to the current stage's mood
    fogTarget.copy(cur >= 0 ? new T.Color(STAGES[cur].fog) : LOBBY_FOG);
    scene.fog.color.lerp(fogTarget, Math.min(1, dt * 2));
    scene.background.copy(scene.fog.color);
    rt.forEach((R, i) => {
        if (!R) return;
        const near = i === cur || Math.abs(camera.position.z - (STAGES[i].zS + STAGES[i].len / 2)) < STAGES[i].len;
        ctx.inStage = i === cur;
        if (R.update && near) R.update(dt, t, ctx);
        if (!near) return;
        for (const h of R.hazards) {
            h.update(dt, t);
            if (i === cur && !ctx.dead && ctx.shield <= 0 && h.hits(ctx.player)) ctx.hitPlayer(h.at.clone(), false);
        }
        for (const g of R.gems) {
            if (g.respawnAt > t) continue;
            if (!g.g.visible) g.g.visible = true;
            g.g.rotation.y += dt * 2.2;
            g.g.position.y = g.base + Math.sin(t * 3 + g.phase) * 0.35;
            if (i === cur && !ctx.dead && Math.abs(g.g.position.x - ctx.player.x) < 2.6 && Math.abs(g.g.position.z - ctx.player.z) < 2.6 && ctx.player.y < g.base + 3) {
                g.g.visible = false; g.respawnAt = t + 12;
                ctx.gem(i, g.id, g.g.position.clone());
            }
        }
    });
}
