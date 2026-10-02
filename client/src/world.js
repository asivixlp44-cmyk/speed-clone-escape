import {
    T, V3, scene, mat, box, aabb, UNIT, solids, triggers, prompts, tickers,
    texFrom, billboard, textPlane, textCanvas, camera, buildRig, animRig,
} from './engine.js';
import { S, actions } from './state.js';
import { brickMaterial, tileMaterial, starMaterial, crateMaterial, lobbyFloorMaterial, studPlateMaterial, beltMaterial, beltTextures } from './textures.js';
import { emitTread, bubble } from './fx.js';
import { THEMES, buildStageTheme } from './stages.js';
import {
    CFG, LOBBY, STAGES, TREADMILLS, TREAD_GEO, PORTALS, portalOpen, LIMITS, PASSES, fmt, comma, hours, clamp, rngFrom, buxText,
} from '../../shared/config.js';

const HX = LOBBY.halfX, HZ = LOBBY.halfZ, WALLH = LOBBY.wallHeight;
const W = CFG.courseWidth, CH = CFG.wallHeight;
// Colours picked from the reference video
const C = {
    stairs: 0x8f86b8, stairsTop: 0x9d95c6, pad: 0xe0283c, padOwned: 0x46ec50, padLocked: 0x7a2a36,
    carpet: 0xd81e34, ceiling: 0x2b2546, trim: 0x3a3360,
    hallWall: 0x6f689a, hallPanel: 0x5d5788, hallFloor: 0x93604e, hallCeiling: 0x4a4470, hallBeam: 0x544d80,
    screenEdge: 0x7fd4ff, jag: 0xffe14a, tree: 0x1fa04a, treeDark: 0x157a36,
};

export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y, LOBBY.spawn.z);
export let beltTex;
const treadItems = [];
const limitItems = [];
const portalItems = [];
const boards = {};

function texturedBox(sx, sy, sz, x, y, z, material, solid) {
    const m = new T.Mesh(UNIT, material);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    scene.add(m);
    if (solid) solids.push(aabb(x, y, z, sx, sy, sz));
    return m;
}
function floorArrow(x, y, z, color, s) {
    const shape = new T.Shape();
    shape.moveTo(0, s); shape.lineTo(s * 0.9, -s * 0.2); shape.lineTo(s * 0.35, -s * 0.2); shape.lineTo(s * 0.35, -s);
    shape.lineTo(-s * 0.35, -s); shape.lineTo(-s * 0.35, -s * 0.2); shape.lineTo(-s * 0.9, -s * 0.2);
    const m = new T.Mesh(new T.ShapeGeometry(shape), mat(color, { neon: true }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); scene.add(m);
    return m;
}

// =====================================================================================
// Decorations: Christmas trees, presents, firework rockets, lamps
// =====================================================================================
const CONE = new T.ConeGeometry(1, 1, 8);
function tree(x, z, s) {
    box(1.2 * s, 2 * s, 1.2 * s, x, s, z, 0x6b4428, { decor: true });
    for (let i = 0; i < 3; i++) {
        const c = new T.Mesh(CONE, mat(i % 2 ? C.tree : C.treeDark));
        c.scale.set((4.2 - i * 1.1) * s, 3.4 * s, (4.2 - i * 1.1) * s);
        c.position.set(x, (3 + i * 2.2) * s, z); c.castShadow = true; scene.add(c);
    }
    const star = new T.Mesh(new T.OctahedronGeometry(0.9 * s), mat(0xffd028, { neon: true }));
    star.position.set(x, 10 * s, z); scene.add(star);
    tickers.push((dt) => { star.rotation.y += dt * 1.5; });
    const cols = [0xff3c50, 0xffd028, 0x3cc8ff, 0xff8fd0];
    for (let i = 0; i < 10; i++) {
        const a = i * 2.4, h = 2.4 + (i % 5) * 1.3;
        const r = (4.2 - (h - 2.4) * 0.5) * s * 0.85;
        const b = new T.Mesh(new T.SphereGeometry(0.32 * s, 8, 6), mat(cols[i % 4], { neon: true }));
        b.position.set(x + Math.cos(a) * r * 0.75, h * s, z + Math.sin(a) * r * 0.75); scene.add(b);
    }
    solids.push(aabb(x, 4 * s, z, 3 * s, 8 * s, 3 * s));
}
function present(x, z, s, color, ribbon) {
    box(2 * s, 1.6 * s, 2 * s, x, 0.8 * s, z, color, { cast: true });
    box(2.05 * s, 1.65 * s, 0.4 * s, x, 0.8 * s, z, ribbon, { decor: true });
    box(0.4 * s, 1.65 * s, 2.05 * s, x, 0.8 * s, z, ribbon, { decor: true });
}
// Red/white striped rocket with a yellow tip, leaning against a wall
function rocket(x, y, z, lean) {
    const g = new T.Group(); g.position.set(x, y, z); g.rotation.z = lean; scene.add(g);
    for (let i = 0; i < 6; i++) {
        const seg = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 1.4, 12), mat(i % 2 ? 0xffffff : 0xe2263f));
        seg.position.y = i * 1.4; g.add(seg);
    }
    const tip = new T.Mesh(new T.ConeGeometry(1, 2, 12), mat(0xffd028, { neon: true }));
    tip.position.y = 6 * 1.4 + 0.3; g.add(tip);
}
function lamp(x, y, z) {
    box(0.5, 4, 0.5, x, y - 2, z, 0x2b2546, { decor: true });
    const l = new T.Mesh(new T.ConeGeometry(1.2, 1.6, 8), mat(0xffe14a, { neon: true }));
    l.position.set(x, y + 0.6, z); scene.add(l);
}

// =====================================================================================
// Leaderboards: Top Wins, Top Playtime, Top Steps
// =====================================================================================
function leaderboard(pos, title) {
    // Navy board hanging high on the wall, tipped forward like the reference "TOP WINS" boards
    const g = new T.Group(); g.position.copy(pos); g.rotation.x = 0.16; scene.add(g);
    const back = new T.Mesh(UNIT, mat(0x1d1b3a)); back.scale.set(14, 17, 1); back.position.set(0, 0, 0.6); g.add(back);
    const rim = new T.Mesh(UNIT, mat(0x3a3680)); rim.scale.set(14.8, 17.8, 0.6); rim.position.set(0, 0, 1); g.add(rim);
    const head = new T.Mesh(UNIT, mat(0x2b2858)); head.scale.set(9, 4, 1.4); head.position.set(0, 9.8, 0.4); g.add(head);
    for (const sx of [-1, 1]) { const ear = new T.Mesh(UNIT, mat(0x2b2858)); ear.scale.set(2, 2.4, 1.4); ear.position.set(sx * 5.4, 8.6, 0.4); g.add(ear); }
    const cv = document.createElement('canvas'); cv.width = 384; cv.height = 480;
    const tex = texFrom(cv);
    const scr = new T.Mesh(new T.PlaneGeometry(12.8, 16), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, -0.4, 0.05); scr.rotation.y = Math.PI; g.add(scr);
    const label = textPlane([{ t: title[0], c: '#ffffff', s: '#16121f', px: 60 }, { t: title[1], c: '#ffffff', s: '#16121f', px: 60 }], 7.4, 512, new V3(0, 0, 0), new V3(0, 0, -10));
    scene.remove(label); label.position.set(0, 9.8, -0.4); label.rotation.set(0, Math.PI, 0); g.add(label);
    return { cv, tex, rows: [], kind: '' };
}
// Little blocky avatar head (pale face, orange hair) used on the boards
function drawHead(x, cx, cy, r, hue) {
    x.fillStyle = '#f2efe6'; x.fillRect(cx - r, cy - r * 0.6, r * 2, r * 1.7);
    x.fillStyle = hue; x.fillRect(cx - r * 1.15, cy - r * 1.05, r * 2.3, r * 0.75); x.fillRect(cx - r * 1.15, cy - r * 0.5, r * 0.45, r);
    x.fillStyle = '#16121f'; x.fillRect(cx - r * 0.45, cy + r * 0.05, r * 0.22, r * 0.3); x.fillRect(cx + r * 0.25, cy + r * 0.05, r * 0.22, r * 0.3);
}
const HAIR = ['#e8761e', '#3a2618', '#e6c878', '#1a1410', '#c84a1a'];
let boardsAt = performance.now();
function drawBoard(b) {
    const x = b.cv.getContext('2d'), kind = b.kind, rows = b.rows;
    x.fillStyle = '#1d1b3a'; x.fillRect(0, 0, 384, 480);
    x.font = '700 22px Fredoka, sans-serif'; x.textBaseline = 'middle';
    x.fillStyle = '#9d97d0'; x.textAlign = 'left'; x.fillText('RANK', 10, 18); x.fillText('NAME', 100, 18);
    x.textAlign = 'right'; x.fillText(kind === 'wins' ? 'WINS' : kind === 'steps' ? 'STEPS' : 'TIME', 374, 18);
    if (!rows.length) { x.textAlign = 'center'; x.fillStyle = '#cfc4f2'; x.fillText('Be the first!', 192, 230); }
    x.font = '700 24px Fredoka, sans-serif';
    rows.forEach((r, i) => {
        const y = 54 + i * 39;
        x.fillStyle = r.you ? 'rgba(70,236,80,0.28)' : i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.09)';
        x.fillRect(6, y - 17, 372, 34);
        x.fillStyle = i === 0 ? '#ffd028' : i === 1 ? '#dfe4f0' : i === 2 ? '#e0925a' : '#ffffff';
        x.textAlign = 'left'; x.fillText(String(i + 1), 22, y);
        drawHead(x, 72, y, 11, HAIR[(r.n.length + i) % HAIR.length]);
        x.fillStyle = r.you ? '#7dff6b' : '#ffffff'; x.fillText(r.n.slice(0, 13), 100, y);
        x.textAlign = 'right'; x.fillStyle = '#ffd028';
        x.fillText(kind === 'playtime' ? hours(r.v) : comma(r.v), 374, y);
    });
    const left = Math.max(0, Math.ceil(10 - (performance.now() - boardsAt) / 1000));
    x.font = 'italic 700 20px Fredoka, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#ffd028';
    x.fillText('Refreshing in ' + left + 's', 192, 462);
    b.tex.needsUpdate = true;
}
// msg = { steps: [{n, v}], wins: [...], playtime: [...] } from the server, top 10 each
export function renderBoards(msg) {
    if (!boards.steps || !msg) return;
    boardsAt = performance.now();
    for (const kind of ['steps', 'wins', 'playtime']) {
        const b = boards[kind];
        b.kind = kind;
        b.rows = (msg[kind] || []).map((r) => ({ n: r.n, v: r.v, you: r.n === S.name }));
        drawBoard(b);
    }
}
// The "Refreshing in Ns" footer counts down between server updates
setInterval(() => { for (const k of ['steps', 'wins', 'playtime']) if (boards[k] && boards[k].kind) drawBoard(boards[k]); }, 1000);

// =====================================================================================
// AUTO RUN treadmills: chunky voxel machines with striped belts
// =====================================================================================
export function treadLocked(def) { return !!def.pass && !S.passes[def.pass]; }
const TREAD_LOOK = {
    1: { base: '#4a4658', belt: '#2e2b38', stripe: '#565266', rail: 0x5a5670, block: null },
    2: { base: '#ff9a1e', belt: '#ffa41e', rail: 0xffc832, block: 0xffd24a, fx: 3 },
    5: { base: '#22c8f0', belt: '#2fc8f0', rail: 0x6fe8ff, block: 0x9ff2ff, fx: 9 },
    10: { base: '#8a2cff', belt: '#a040ff', rail: 0xc070ff, block: 0xd8a0ff, fx: 25 },
};
const BLUE_OUT = '#1d4fd0';
function treadLines(def) {
    const lines = [{ t: def.mult > 1 ? 'x' + def.mult + ' Steps' : 'AUTO RUN', c: '#ffffff', s: BLUE_OUT, px: 84 }];
    if (treadLocked(def)) lines.push({ t: '🔒 ' + buxText(PASSES[def.pass].price), c: '#ffd23a', s: '#16121f', px: 48 });
    return lines;
}
function buildTreadmill(def, x, top, z, rng) {
    const L = TREAD_GEO.len, Wd = TREAD_GEO.width, look = TREAD_LOOK[def.mult];
    const baseMat = studPlateMaterial(look.base, (Wd + 3) / 2, (L + 3) / 2);
    texturedBox(Wd + 3, top, L + 3, x, top / 2, z, baseMat, true);
    const belt = new T.Mesh(UNIT, beltMaterial(look.belt, look.stripe));
    belt.scale.set(Wd, 0.3, L); belt.position.set(x, top + 0.15, z); belt.receiveShadow = true; scene.add(belt);
    const c = aabb(x, top + 0.15, z, Wd, 0.3, L); c.tread = def; solids.push(c);
    // Thick blocky side rails with a row of studs on top
    for (const s of [-1, 1]) {
        const rx = x + s * (Wd / 2 + 0.75);
        texturedBox(1.5, 1.4, L + 3, rx, top + 0.7, z, studPlateMaterial(look.base, 1, (L + 3) / 2), true);
        for (let k = 0; k < 6; k++) box(0.7, 0.35, 0.7, rx, top + 1.55, z - L / 2 + 1 + k * (L - 2) / 5, look.rail, { decor: true, neon: !!look.block });
    }
    // Console at the far end: chunky body, screen, red and green buttons
    const ez = z + L / 2 + 1;
    for (const s of [-1, 1]) box(0.9, 5.4, 0.9, x + s * (Wd / 2 + 0.4), top + 2.7, ez, 0x26232e, { decor: true });
    const con = box(Wd + 1.8, 1.8, 2.2, x, top + 5.6, ez, 0x16121f, { decor: true });
    con.rotation.x = -0.4; con.updateMatrix();
    const scrn = box(Wd - 1.2, 0.12, 1.2, x + 0.6, top + 6.55, ez - 0.3, 0x7fe8ff, { neon: true, decor: true });
    scrn.rotation.x = -0.4; scrn.updateMatrix();
    box(0.7, 0.2, 0.7, x - Wd / 2 + 0.6, top + 6.5, ez - 0.2, 0xff3045, { neon: true, decor: true });
    box(0.7, 0.2, 0.7, x - Wd / 2 + 1.6, top + 6.5, ez - 0.2, 0x46ec50, { neon: true, decor: true });
    // Pass treadmills grow voxel sculptures: stepped towers either side and a crown over the console
    if (look.block) {
        for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
            const h = 1.2 + rng() * 1.6, sz = 1.6 + rng() * 1.4;
            box(1.6, h, sz, x + s * (Wd / 2 + 2.3), top + h / 2, z - L / 2 + 1.5 + k * (L - 3) / 4, k % 2 ? look.block : look.rail, { decor: true });
        }
        for (let k = -2; k <= 2; k++) box(1.6, 1.6 + Math.abs(k) * 0.5, 1.6, x + k * 1.7, top + 8, ez + 0.4, k % 2 ? look.block : look.rail, { decor: true, neon: k === 0 });
    }
    const sp = billboard(treadLines(def), 9, 512, new V3(x, top + 12.5, ez));
    treadItems.push({ def, sp, sig: '' });
    if (look.fx) {
        const at = new V3(x, top + 0.5, z);
        let acc = Math.random();
        tickers.push((dt) => {
            if (camera.position.distanceToSquared(at) > 120 * 120) return;
            acc += dt * 12; while (acc > 1) { acc -= 1; emitTread(at, look.fx, Wd, L); }
        });
    }
    prompts.push({
        pos: new V3(x, top, z - L / 2 - 1), r: 4.5,
        label: () => treadLocked(def) ? 'Unlock ' + PASSES[def.pass].name : 'Step on to auto run',
        act: () => { if (treadLocked(def)) actions.buy('pass', def.pass); },
    });
}
// Belts scroll toward the runner
tickers.push((dt) => { for (const t of beltTextures) t.offset.y = (t.offset.y + dt * 0.9) % 1; });

// =====================================================================================
// Clone limit stairs: a grand switchback staircase with a cushion pad on every landing
// =====================================================================================
const quiltTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = 'rgba(0,0,0,0.28)'; x.lineWidth = 3;
    for (let i = -64; i < 128; i += 16) {
        x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke();
        x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke();
    }
    const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(2, 2);
    return t;
})();
const padMats = new Map();
function padMat(color) {
    if (!padMats.has(color)) padMats.set(color, new T.MeshLambertMaterial({ color, map: quiltTex }));
    return padMats.get(color);
}
function limitLines(i) {
    const d = i < 0 ? { cost: 0, add: 0 } : LIMITS[i];
    return [{ t: comma(d.cost) + ' Wins 🏆', c: '#ffffff', s: '#16121f', px: 60 }, { t: '+' + d.add + ' Clone Limit 😎', c: '#ffffff', s: '#16121f', px: 66 }];
}
function cushion(x, y, z, color) {
    box(9.6, 0.6, 9.6, x, y + 0.3, z, 0x3a3652, { decor: true });
    const m = new T.Mesh(UNIT, padMat(color));
    m.scale.set(8.4, 1, 8.4); m.position.set(x, y + 0.8, z); m.castShadow = true; scene.add(m);
    return m;
}
const STAIR = '#8f8ab8', STAIR_DARK = '#7a74a6';
// Solid stepped block from the floor up to height h
function stairBlock(sx, h, sz, x, z, dark) {
    texturedBox(sx, h, sz, x, h / 2, z, studPlateMaterial(dark ? STAIR_DARK : STAIR, sx / 2, sz / 2), true);
}
// A flight of small steps between two heights along +x or -x
function flight(x0, x1, h0, h1, z, wz) {
    const n = Math.max(1, Math.ceil((h1 - h0) / 0.8)), dx = (x1 - x0) / n;
    for (let k = 1; k <= n; k++) stairBlock(Math.abs(dx) + 0.02, h0 + (h1 - h0) * k / n, wz, x0 + dx * (k - 0.5), z, k % 2 === 0);
}
function buildStairs() {
    // Lane A climbs east (pads 0 Wins, 3, 15, 100); lane B climbs back west (500 ... 75,000)
    const laneA = { z: 6, wz: 20 }, laneB = { z: 32, wz: 20 };
    const xs = [24, 38, 52, 66], PD = 9;
    const hA = [1.2, 3.6, 6, 8.4], hB = [10.8, 13.2, 15.6, 18];
    flight(14, xs[0] - PD / 2, 0, hA[0], laneA.z, laneA.wz);
    for (let k = 0; k < 4; k++) {
        stairBlock(PD, hA[k], laneA.wz, xs[k], laneA.z, false);
        if (k < 3) flight(xs[k] + PD / 2, xs[k + 1] - PD / 2, hA[k], hA[k + 1], laneA.z, laneA.wz);
    }
    // Corner landing joining the two lanes
    flight(xs[3] + PD / 2, 74, hA[3], 9.6, laneA.z, laneA.wz);
    stairBlock(6, 9.6, laneA.wz + laneB.wz + 6, 77, (laneA.z + laneB.z) / 2, true);
    flight(74, xs[3] + PD / 2, 9.6, hB[0], laneB.z, laneB.wz);
    for (let k = 0; k < 4; k++) {
        stairBlock(PD, hB[k], laneB.wz, xs[3 - k], laneB.z, true);
        if (k < 3) flight(xs[3 - k] - PD / 2, xs[2 - k] + PD / 2, hB[k], hB[k + 1], laneB.z, laneB.wz);
    }
    // Divider wall between the two lanes
    stairBlock(xs[3] - xs[0] + PD + 8, 10, 6, (xs[0] + xs[3]) / 2 + 2, (laneA.z + laneA.wz / 2 + laneB.z - laneB.wz / 2) / 2, true);
    const slots = [[xs[0], hA[0], laneA.z, -1], [xs[1], hA[1], laneA.z, 0], [xs[2], hA[2], laneA.z, 1], [xs[3], hA[3], laneA.z, 2],
        [xs[3], hB[0], laneB.z, 3], [xs[2], hB[1], laneB.z, 4], [xs[1], hB[2], laneB.z, 5], [xs[0], hB[3], laneB.z, 6]];
    for (const [x, h, z, i] of slots) {
        const pad = cushion(x, h, z, i < 0 ? C.padOwned : C.pad);
        const sp = billboard(limitLines(i), 12, 512, new V3(x, h + 7.5, z));
        if (i < 0) continue;
        limitItems.push({ i, sp, pad, sig: '' });
        const tr = aabb(x, h + 2.5, z, 8.4, 4, 8.4);
        tr.enter = () => actions.limit(i);
        triggers.push(tr);
    }
}

// =====================================================================================
// Stage portals: a portal hall along the south wall. Every arch has a swirling gate,
// a lit sign plate, a floating crystal and lanterns; future stages are boarded up.
// =====================================================================================
const PORTAL_COLORS = [0x46ec50, 0xff8a1e, 0x3fd8ff, 0xc428ff, 0xff3fa0, 0xffd028];
function portalLines(p) {
    if (p.soon) return [{ t: 'STAGE ' + p.stage, c: '#ffffff', s: '#3a1490', px: 96 }, { t: 'COMING SOON!', c: '#d8b8ff', s: '#16121f', px: 56 }];
    return [{ t: 'STAGE ' + p.stage, c: '#ffffff', s: BLUE_OUT, px: 96 },
        portalOpen(p, S.portals) ? { t: p.cost === 0 ? '✔ FREE' : '✔ UNLOCKED', c: '#7dff6b', s: '#16121f', px: 56 } : { t: 'Cost ' + comma(p.cost) + ' Wins 🏆', c: '#ffd028', s: '#16121f', px: 56 }];
}
const lockTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.lineWidth = 8; x.strokeStyle = '#16121f';
    x.fillStyle = '#2f7bff'; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill(); x.stroke();
    x.lineWidth = 12; x.strokeStyle = '#ffd028'; x.beginPath(); x.arc(64, 54, 18, Math.PI, 0); x.stroke();
    x.fillStyle = '#ffd028'; x.fillRect(38, 54, 52, 36); x.lineWidth = 5; x.strokeStyle = '#16121f'; x.strokeRect(38, 54, 52, 36);
    x.font = '700 24px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeText('LOCKED', 64, 72); x.fillStyle = '#ffffff'; x.fillText('LOCKED', 64, 72);
    return texFrom(c);
})();
// Swirling gate surface: spiral arms around a bright core, dimmed while locked
const swirlMats = [], portalGates = [];
function swirlMaterial(color) {
    const m = new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new T.Color(color) }, uDim: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            uniform float uTime, uDim; uniform vec3 uColor; varying vec2 vUv;
            void main() {
                vec2 p = (vUv - 0.5) * vec2(1.0, 1.75);
                float r = length(p), a = atan(p.y, p.x);
                float arms = 0.5 + 0.5 * sin(a * 3.0 + r * 14.0 - uTime * 3.0);
                float core = exp(-r * 4.0);
                vec3 col = mix(uColor * 0.35, uColor * 1.15, arms) + vec3(core * 0.9);
                float edge = smoothstep(0.98, 0.8, r * 1.15);
                gl_FragColor = vec4(col * uDim, 1.0) * vec4(1.0, 1.0, 1.0, edge);
                #include <colorspace_fragment>
            }`,
        transparent: true, toneMapped: false,
    });
    swirlMats.push(m);
    return m;
}
// A lit sign plate whose text can be redrawn (same .userData.set API as billboards).
// It faces +z, or +x when faceX is set (for signs seen from the east).
function signPlate(x, y, z, w, h, lines, faceX) {
    const dims = (sx, sz) => (faceX ? [sz, sx] : [sx, sz]);
    const off = (d) => (faceX ? [x + d, z] : [x, z + d]);
    let [a1, b1] = dims(w + 0.8, 0.5), [ox, oz] = off(0); box(a1, h + 0.8, b1, ox, y, oz, 0x3a2414, { decor: true });
    [a1, b1] = dims(w, 0.6); [ox, oz] = off(0.05); box(a1, h, b1, ox, y, oz, 0x1d1b3a, { decor: true });
    for (const s of [-1, 1]) { [ox, oz] = faceX ? [x + 0.4, z - s * (w / 2 + 0.1)] : [x + s * (w / 2 + 0.1), z + 0.4]; box(0.3, 0.3, 0.3, ox, y + h / 2 + 0.1, oz, 0xffd028, { neon: true, decor: true }); }
    const mesh = new T.Mesh(new T.PlaneGeometry(w - 0.4, h - 0.4), new T.MeshBasicMaterial({ transparent: true, toneMapped: false }));
    [ox, oz] = off(0.42); mesh.position.set(ox, y, oz); if (faceX) mesh.rotation.y = Math.PI / 2; scene.add(mesh);
    mesh.userData.set = (nl) => {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.map = texFrom(textCanvas(nl, 512)); mesh.material.needsUpdate = true;
    };
    mesh.userData.set(lines);
    return mesh;
}
function lantern(x, z) {
    box(0.6, 7, 0.6, x, 4.3, z, 0x26232e, { decor: true });
    box(1.6, 0.4, 1.6, x, 7.9, z, 0x26232e, { decor: true });
    box(1.3, 1.6, 1.3, x, 8.9, z, 0xffc040, { neon: true, decor: true });
    box(1.7, 0.4, 1.7, x, 9.9, z, 0x26232e, { decor: true });
    const glow = new T.Mesh(new T.CircleGeometry(3.4, 24), new T.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.12, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(x, 0.86, z); scene.add(glow);
}
function buildPortals() {
    const wallZ = -HZ + 0.4, z = -HZ + 3.2, DAIS = 0.8;
    // Raised dais the arches stand on, with a glowing front edge and a step
    texturedBox(124, DAIS, 14, 0, DAIS / 2, -HZ + 7, studPlateMaterial('#6e6896', 31, 4), true);
    box(124, 0.25, 0.4, 0, DAIS + 0.05, -HZ + 14, 0xb48cff, { neon: true, decor: true });
    texturedBox(124, 0.4, 2, 0, 0.2, -HZ + 15, studPlateMaterial('#7f79a8', 31, 1), true);
    // Stone backing wall with battlements and a big header sign
    texturedBox(124, 24, 3, 0, 12, wallZ, studPlateMaterial('#4a4658', 31, 6), true);
    for (let x = -60; x <= 60; x += 6) box(3, 2.2, 3.2, x, 25.1, wallZ, 0x4a4658, { decor: true });
    box(46, 8, 1, 0, 34, wallZ + 1.4, 0x6a2fd0, { decor: true });
    box(47, 0.6, 1.2, 0, 30.2, wallZ + 1.6, 0xffd028, { neon: true, decor: true });
    box(47, 0.6, 1.2, 0, 37.8, wallZ + 1.6, 0xffd028, { neon: true, decor: true });
    textPlane([{ t: '✦ STAGE PORTALS ✦', c: '#ffffff', s: '#3a1490', px: 120 }, { t: 'Unlock a stage once - start there any time!', c: '#ffd028', s: '#16121f', px: 50 }],
        44, 1024, new V3(0, 34, wallZ + 2.05), new V3(0, 34, wallZ + 20));
    PORTALS.forEach((p, i) => {
        const x = -54 + i * 18, col = p.soon ? 0x8a5cff : PORTAL_COLORS[i % PORTAL_COLORS.length];
        const y0 = DAIS;
        // Arch: stud pillars, a stepped crown, a neon rim around the opening
        for (const s of [-1, 1]) {
            texturedBox(3, 18, 3.4, x + s * 6.3, y0 + 9, z, studPlateMaterial('#5a5668', 2, 9), true);
            box(3.6, 1.2, 4, x + s * 6.3, y0 + 0.6, z, 0x3a3652, { decor: true });
            box(0.5, 16.6, 0.5, x + s * 5, y0 + 8.3, z + 1.5, col, { neon: true, decor: true });
        }
        texturedBox(15.6, 4, 3.4, x, y0 + 19, z, studPlateMaterial('#5a5668', 8, 2), false);
        for (let k = -2; k <= 2; k++) box(1.6, 1.4 + (k === 0 ? 1 : 0), 3.4, x + k * 3.2, y0 + 21.7 + (k === 0 ? 0.5 : 0), z, 0x5a5668, { decor: true });
        box(10.5, 0.5, 0.5, x, y0 + 16.8, z + 1.5, col, { neon: true, decor: true });
        // Glowing runner from the dais edge to the gate
        box(8, 0.06, 10, x, DAIS + 0.04, z + 6.5, col, { opacity: 0.35, decor: true });
        let lock = null;
        if (!p.soon) {
            const gate = new T.Mesh(new T.PlaneGeometry(9.6, 16.6), swirlMaterial(col));
            gate.position.set(x, y0 + 8.3, z + 0.9); scene.add(gate);
            lock = new T.Mesh(new T.PlaneGeometry(5.6, 5.6), new T.MeshBasicMaterial({ map: lockTex, transparent: true, toneMapped: false }));
            lock.position.set(x, y0 + 8, z + 1.2); scene.add(lock);
            // Floating crystal over the crown, bobbing and spinning
            const gem = new T.Mesh(new T.OctahedronGeometry(1.3, 0), mat(col, { neon: true }));
            gem.scale.set(1, 1.5, 1); scene.add(gem);
            const ph = i * 1.7;
            tickers.push((dt, t) => { gem.rotation.y += dt * 1.6; gem.position.set(x, y0 + 25.6 + Math.sin(t * 2 + ph) * 0.4, z + 0.5); });
            gate.userData.portal = p; gate.userData.mat = gate.material;
            portalGates.push(gate);
        } else {
            // Boarded-up doorway: dark glow behind crossed planks and a padlock
            box(9.6, 16.6, 0.3, x, y0 + 8.3, z + 0.6, 0x1a1030, { decor: true });
            const glow = new T.Mesh(new T.PlaneGeometry(9.6, 16.6), swirlMaterial(col));
            glow.position.set(x, y0 + 8.3, z + 0.8); glow.material.uniforms.uDim.value = 0.35; scene.add(glow);
            for (const [ry, py] of [[0.55, 5], [-0.55, 5], [0.5, 12], [-0.5, 12]]) {
                const plank = box(11, 1.4, 0.5, x, y0 + py, z + 1.3, 0x8a5a2c, { decor: true });
                plank.rotation.z = ry; plank.updateMatrix();
            }
            for (const py of [2.5, 8.5, 14.5]) box(10.8, 1.2, 0.5, x, y0 + py, z + 1.6, 0xa06a34, { decor: true });
            box(2.4, 2, 0.6, x, y0 + 8.5, z + 2, 0xffd028, { decor: true });
            box(1.4, 1.2, 0.3, x, y0 + 10, z + 2, 0xc8a01e, { decor: true });
        }
        const sp = signPlate(x, y0 + 19.2, z + 2, 12, 4.4, portalLines(p));
        portalItems.push({ p, sp, lock, sig: '' });
        if (i < PORTALS.length - 1) lantern(x + 9, z + 5);
        const tr = aabb(x, y0 + 6, z + 2.6, 9, 12, 2.4);
        tr.enter = () => actions.portal(p);
        triggers.push(tr);
    });
    tickers.push((dt, t) => {
        for (const g of portalGates) {
            g.material.uniforms.uTime.value = t;
            g.material.uniforms.uDim.value = portalOpen(g.userData.portal, S.portals) ? 1 : 0.55;
        }
        for (const m of swirlMats) if (m.uniforms.uDim.value < 0.5) m.uniforms.uTime.value = t * 0.4;
    });
}
// =====================================================================================
// West wing: the Clone Lab centrepiece, the Rebirth altar, the FREE gift station,
// framed posters and fairy lights along every wall
// =====================================================================================
const CLONE_LOOK = { shirt: 0x1c1c22, shorts: 0x26302a, socks: 0x26302a, hair: 0xe8761e, skin: 0xf2efe6, hairStyle: 'shaggy', plain: true };
function ringAt(x, y, z, r, tube, color) {
    const m = new T.Mesh(new T.TorusGeometry(r, tube, 8, 40), mat(color, { neon: true }));
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z); scene.add(m);
    return m;
}
function glassTube(x, y, z, r, h) {
    const glass = new T.Mesh(new T.CylinderGeometry(r, r, h, 32, 1, true), new T.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide }));
    glass.position.set(x, y + h / 2, z); scene.add(glass);
    for (const [yy, hh] of [[y + 0.5, 1], [y + h - 0.3, 1.2]]) {
        const cap = new T.Mesh(new T.CylinderGeometry(r + 0.5, r + 0.5, hh, 32), mat(0x2b2546));
        cap.position.set(x, yy, z); cap.castShadow = true; scene.add(cap);
    }
    ringAt(x, y + 1.05, z, r + 0.25, 0.18, 0x6fe0ff);
    ringAt(x, y + h - 0.95, z, r + 0.25, 0.18, 0x6fe0ff);
    solids.push(aabb(x, y + h / 2, z, r * 1.6, h, r * 1.6));
}
function buildCloneLab(cx, cz) {
    // Two-tier round dais
    const t1 = new T.Mesh(new T.CylinderGeometry(11, 11.5, 1, 48), studPlateMaterial('#5d5790', 10, 1)); t1.position.set(cx, 0.5, cz); t1.receiveShadow = true; scene.add(t1);
    const t2 = new T.Mesh(new T.CylinderGeometry(7.5, 8, 1, 48), studPlateMaterial('#6e68a2', 8, 1)); t2.position.set(cx, 1.5, cz); scene.add(t2);
    solids.push(aabb(cx, 0.5, cz, 20, 1, 20), aabb(cx, 1.5, cz, 13.5, 1, 13.5));
    ringAt(cx, 1.02, cz, 11.2, 0.22, 0xb48cff);
    ringAt(cx, 2.02, cz, 7.7, 0.22, 0x6fe0ff);
    // Big central tube with a clone turning inside and a scan ring sweeping up and down
    glassTube(cx, 2, cz, 3.4, 13);
    const hero = buildRig(CLONE_LOOK); hero.position.set(cx, 3, cz); hero.scale.setScalar(1.25); scene.add(hero);
    const scan = ringAt(cx, 4, cz, 3.1, 0.14, 0x7dff6b);
    const beam = new T.Mesh(new T.CylinderGeometry(3.1, 3.1, 0.6, 32, 1, true), new T.MeshBasicMaterial({ color: 0x7dff6b, transparent: true, opacity: 0.25, depthWrite: false, side: T.DoubleSide }));
    beam.position.set(cx, 4, cz); scene.add(beam);
    // Two side pods where the fresh clones flicker into being
    const pods = [];
    for (const s of [-1, 1]) {
        const px = cx + s * 8.6, pz = cz + 2;
        glassTube(px, 0, pz, 2.2, 8.5);
        const ghost = buildRig(CLONE_LOOK); ghost.position.set(px, 1, pz); scene.add(ghost);
        ghost.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; } });
        pods.push(ghost);
        // Pipe from the pod back to the main tube
        const pipe = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 5, 12), mat(0x3a3680));
        pipe.rotation.z = Math.PI / 2; pipe.position.set(cx + s * 5.4, 9.6, cz + 1); scene.add(pipe);
    }
    // Top machinery: a chunky cap with blinking lights
    box(9, 1.6, 9, cx, 15.8, cz, 0x2b2546, { decor: true });
    const blink = [];
    for (let k = 0; k < 6; k++) {
        const m = new T.Mesh(UNIT, new T.MeshBasicMaterial({ color: 0xff3045 })); m.scale.setScalar(0.6);
        const a = k / 6 * Math.PI * 2; m.position.set(cx + Math.cos(a) * 4.6, 15.8, cz + Math.sin(a) * 4.6); scene.add(m); blink.push(m);
    }
    const sign = signPlate(cx, 20, cz + 1, 14, 4.6, [{ t: '🧪 CLONE LAB', c: '#7dff6b', s: '#16121f', px: 96 }, { t: '1 Level = +1 Clone!', c: '#ffffff', s: '#16121f', px: 56 }], true);
    tickers.push((dt, t) => {
        if (camera.position.distanceToSquared(hero.position) > 140 * 140) return;
        hero.rotation.y += dt * 0.8;
        animRig(hero, t * 3, 0.35);
        const yy = 3 + (Math.sin(t * 1.6) * 0.5 + 0.5) * 8;
        scan.position.y = yy; beam.position.y = yy;
        pods.forEach((g, k) => {
            const ph = ((t * 0.5 + k * 0.5) % 1);
            const a = ph < 0.6 ? ph / 0.6 : 1 - (ph - 0.6) / 0.4;
            g.traverse((o) => { if (o.isMesh) o.material.opacity = Math.max(0.05, a) * (0.6 + 0.4 * Math.sin(t * 30)); });
            g.rotation.y = -t * 0.6;
        });
        blink.forEach((m, k) => m.material.color.setHex(Math.floor(t * 4 + k) % 3 === 0 ? 0xff3045 : Math.floor(t * 4 + k) % 3 === 1 ? 0xffd028 : 0x46ec50));
        if (Math.random() < dt * 4) bubbleAt(cx + (Math.random() - 0.5) * 5, 3 + Math.random() * 10, cz + (Math.random() - 0.5) * 5, 0x7dff6b);
    });
}
const bubbleAt = (x, y, z, c) => bubble(new V3(x, y, z), c);
function buildRebirthAltar(cx, cz) {
    for (let k = 0; k < 3; k++) texturedBox(14 - k * 3.5, 1, 14 - k * 3.5, cx, 0.5 + k, cz, studPlateMaterial(k % 2 ? '#7a3cc8' : '#5a2fa0', 4, 4), true);
    // Rebirth emblem: a red and white disc spinning on its axis, inside a glowing ring
    const g = new T.Group(); g.position.set(cx, 9, cz); scene.add(g);
    const top = new T.Mesh(new T.CylinderGeometry(3.4, 3.4, 0.9, 40, 1, false, 0, Math.PI), mat(0xe82434));
    top.rotation.x = Math.PI / 2; g.add(top);
    const bot = new T.Mesh(new T.CylinderGeometry(3.4, 3.4, 0.9, 40, 1, false, Math.PI, Math.PI), mat(0xf5f5f5));
    bot.rotation.x = Math.PI / 2; g.add(bot);
    const band = new T.Mesh(UNIT, mat(0x16121f)); band.scale.set(6.9, 0.5, 1); g.add(band);
    const btn = new T.Mesh(new T.CylinderGeometry(1, 1, 1.1, 24), mat(0xffffff)); btn.rotation.x = Math.PI / 2; g.add(btn);
    const halo = ringAt(cx, 9, cz, 4.6, 0.25, 0xc428ff); halo.rotation.x = 0;
    const col = new T.Mesh(new T.CylinderGeometry(3.5, 4.5, 14, 32, 1, true), new T.MeshBasicMaterial({ color: 0xc428ff, transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide }));
    col.position.set(cx, 10, cz); scene.add(col);
    const sign = signPlate(cx + 7.6, 4.6, cz, 10, 3.6, [{ t: '🔄 REBIRTH', c: '#e2a8ff', s: '#16121f', px: 90 }, { t: 'Reach Lvl ' + CFG.rebirthLevel + ' · +50% Steps', c: '#ffffff', s: '#16121f', px: 46 }], true);
    tickers.push((dt, t) => { g.rotation.y += dt * 1.2; g.position.y = 9 + Math.sin(t * 1.5) * 0.4; halo.rotation.y += dt * 0.6; halo.rotation.x = Math.sin(t) * 0.3; });
    const tr = aabb(cx, 5, cz, 8, 6, 8);
    tr.enter = () => actions.openPanel('rebirth');
    triggers.push(tr);
}
function buildFreeStation(cx, cz) {
    texturedBox(12, 0.8, 12, cx, 0.4, cz, studPlateMaterial('#c8283c', 6, 6), true);
    ringAt(cx, 0.85, cz, 5.8, 0.2, 0xffd028);
    const g = new T.Group(); g.position.set(cx, 0.8, cz); scene.add(g);
    const body = new T.Mesh(UNIT, mat(0xe82434)); body.scale.set(6, 4.6, 6); body.position.y = 2.3; body.castShadow = true; g.add(body);
    const lid = new T.Mesh(UNIT, mat(0xff4a5a)); lid.scale.set(6.6, 1.4, 6.6); lid.position.y = 5.3; g.add(lid);
    for (const [sx, sz] of [[1.3, 6.7], [6.7, 1.3]]) { const r = new T.Mesh(UNIT, mat(0xffd028)); r.scale.set(sx, 6.2, sz); r.position.y = 3.05; g.add(r); }
    for (const s of [-1, 1]) {
        const loop = new T.Mesh(new T.TorusGeometry(1.3, 0.45, 8, 16), mat(0xffd028)); loop.position.set(s * 1.2, 6.8, 0); loop.rotation.z = s * 0.6; g.add(loop);
    }
    solids.push(aabb(cx, 3.6, cz, 6.6, 5.6, 6.6));
    const sign = signPlate(cx, 11, cz, 10, 3.6, [{ t: '🎁 FREE GIFTS', c: '#ffd028', s: '#16121f', px: 90 }, { t: 'Play to unlock rewards!', c: '#ffffff', s: '#16121f', px: 46 }], true);
    tickers.push((dt, t) => { g.position.y = 0.8 + Math.abs(Math.sin(t * 2.2)) * 0.5; g.rotation.y = Math.sin(t * 1.1) * 0.25; });
    const tr = aabb(cx, 3, cz, 10, 6, 10);
    tr.enter = () => actions.openPanel('free');
    triggers.push(tr);
}
// Framed poster on a wall (facing +x for the west wall)
function poster(x, y, z, title, sub, icon, bg) {
    const c = document.createElement('canvas'); c.width = 384; c.height = 288;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 288); grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]);
    g.fillStyle = grd; g.fillRect(0, 0, 384, 288);
    g.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(192, 150); g.arc(192, 150, 300, i * 0.524, i * 0.524 + 0.26); g.fill(); }
    g.font = '110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, 192, 120);
    g.font = '700 46px Fredoka, sans-serif'; g.lineWidth = 8; g.strokeStyle = '#16121f'; g.lineJoin = 'round';
    g.strokeText(title, 192, 220); g.fillStyle = '#ffffff'; g.fillText(title, 192, 220);
    g.font = '700 26px Fredoka, sans-serif'; g.lineWidth = 6; g.strokeText(sub, 192, 262); g.fillStyle = '#ffd028'; g.fillText(sub, 192, 262);
    box(0.6, 12.6, 16.6, x, y, z, 0xffd028, { decor: true });
    const m = new T.Mesh(new T.PlaneGeometry(15.6, 11.6), new T.MeshBasicMaterial({ map: texFrom(c), toneMapped: false }));
    m.position.set(x + 0.35, y, z); m.rotation.y = Math.PI / 2; scene.add(m);
}
// Strings of blinking coloured bulbs along the top of the star panels
function fairyLights() {
    const cols = [0xff3c50, 0xffd028, 0x3cc8ff, 0x46ec50];
    const mats = cols.map((c) => new T.MeshBasicMaterial({ color: c }));
    const geo = new T.SphereGeometry(0.35, 8, 6);
    let k = 0;
    const add = (x, y, z) => { const m = new T.Mesh(geo, mats[k++ % 4]); m.position.set(x, y, z); scene.add(m); };
    for (let x = -HX + 2; x <= HX - 2; x += 3) {
        const sag = Math.abs(Math.sin((x / 15) * Math.PI)) * 1.6;
        if (Math.abs(x) > 26) add(x, 22.6 - sag, HZ - 1);
        add(x, 22.6 - sag, -HZ + 1);
    }
    for (let z = -HZ + 2; z <= HZ - 2; z += 3) {
        const sag = Math.abs(Math.sin((z / 15) * Math.PI)) * 1.6;
        add(-HX + 1, 22.6 - sag, z); add(HX - 1, 22.6 - sag, z);
    }
    tickers.push((dt, t) => {
        mats.forEach((m, i) => { const on = Math.floor(t * 2.5 + i) % 4 !== 0; m.color.setHex(cols[i]).multiplyScalar(on ? 1.5 : 0.25); });
    });
}
function buildWestWing() {
    buildCloneLab(-48, -16);
    buildRebirthAltar(-70, -42);
    buildFreeStation(-70, 4);
    poster(-HX + 0.3, 12, -24, '1 LEVEL = +1 CLONE', 'Walk to level up!', '👥', ['#2f7bff', '#1d3fa0']);
    poster(-HX + 0.3, 12, 26, 'BEAT STAGES', 'Clones protect you!', '🏆', ['#ff8a1e', '#c8401a']);
    poster(-HX + 0.3, 12, -56, 'AUTO RUN', 'Free Steps on treadmills', '👟', ['#8a2cff', '#4a149a']);
    fairyLights();
}

// =====================================================================================
// Lobby
// =====================================================================================
// Lumpy yellow blob (the reference has these stuck to the gate pillars)
function blob(x, y, z, s) {
    const offs = [[0, 0, 0, 1.6], [1.1, 0.3, 0.2, 1.1], [-1.2, -0.2, 0.1, 1.2], [0.4, 0.9, 0, 1], [-0.5, -0.9, 0.2, 0.9]];
    for (const [ox, oy, oz, k] of offs) box(k * s, k * s * 0.8, 0.8 * s, x + ox * s, y + oy * s, z + oz * s, 0xffe82a, { neon: true, decor: true });
}
// Hanging fluorescent tube
function tubeLamp(x, y, z, len) {
    for (const s of [-1, 1]) box(0.15, 3, 0.15, x + s * len * 0.35, y + 1.6, z, 0x16121f, { decor: true });
    box(len, 0.7, 1.4, x, y, z, 0x2b2546, { decor: true });
    box(len - 0.6, 0.25, 0.9, x, y - 0.42, z, 0xfff6c8, { neon: true, decor: true });
}

function buildLobby() {
    const rng = rngFrom(11);
    // Lavender-grey stud baseplate, with a raised light checker plaza down the middle
    texturedBox(HX * 2, 2, HZ * 2, 0, -1, 0, lobbyFloorMaterial(HX * 2 / 4, HZ * 2 / 4), true);
    const plazaZ0 = -46, plazaZ1 = HZ - 14;
    texturedBox(26, 0.4, plazaZ1 - plazaZ0, 0, 0.2, (plazaZ0 + plazaZ1) / 2, tileMaterial(26 / 5, (plazaZ1 - plazaZ0) / 5), true);
    box(26.6, 0.2, plazaZ1 - plazaZ0 + 0.6, 0, 0.05, (plazaZ0 + plazaZ1) / 2, 0x6a6496, { decor: true });

    // Walls: red and navy star panels below, lavender bricks with sky windows above
    const half = W / 2, seg = HX - half, low = 24;
    const wall = (sx, sz, x, z, navy) => {
        texturedBox(sx, low, sz, x, low / 2, z, starMaterial(navy, Math.max(sx, sz) / 20, low / 20), true);
        texturedBox(sx + 0.2, WALLH - low, sz + 0.2, x, low + (WALLH - low) / 2, z, brickMaterial(0xb9b0ea, Math.max(sx, sz) / 10, (WALLH - low) / 6), true);
    };
    wall(seg, 2, -(half + seg / 2), HZ + 1, false);
    wall(seg, 2, half + seg / 2, HZ + 1, false);
    wall(HX * 2 + 4, 2, 0, -HZ - 1, true);
    wall(2, HZ * 2, -HX - 1, 0, true);
    wall(2, HZ * 2, HX + 1, 0, false);
    for (let x = -70; x <= 70; x += 20) if (Math.abs(x) > 30) box(10, 7, 0.4, x, 31, HZ - 0.2, 0x9fe6ff, { neon: true, decor: true });
    for (let z = -50; z <= 50; z += 25) {
        box(0.4, 7, 10, -HX + 0.2, 31, z, 0x9fe6ff, { neon: true, decor: true });
        box(0.4, 7, 10, HX - 0.2, 31, z, 0x9fe6ff, { neon: true, decor: true });
    }
    // Navy pillars and a stud trim between the star panels and the bricks
    for (let x = -HX + 20; x < HX; x += 30) if (Math.abs(x) > half + 6) box(3, low, 1.4, x, low / 2, HZ - 0.2, 0x1f2244, { decor: true });
    for (const [sx, sz, x, z] of [[HX * 2, 1.2, 0, HZ - 0.4], [HX * 2, 1.2, 0, -HZ + 0.4], [1.2, HZ * 2, -HX + 0.4, 0], [1.2, HZ * 2, HX - 0.4, 0]]) box(sx, 1.4, sz, x, low, z, 0x3a3680, { decor: true });
    box(HX * 2 + 6, 2, HZ * 2 + 6, 0, WALLH + 1, 0, C.ceiling, { decor: true });
    for (const x of [-50, 0, 50]) for (const z of [-40, 0, 40]) box(10, 0.3, 3, x, WALLH - 0.15, z, 0xffffff, { neon: true, decor: true });

    // ----- Stage 1 gate: a deep alcove of dark stud bricks around the glowing screen -----
    const AD = 14, aTop = 26, wallX = half + 2.5, z0 = HZ - AD;
    const dark = studPlateMaterial('#55516a', 2, 8);
    for (const s of [-1, 1]) {
        texturedBox(3, aTop, AD, s * wallX, aTop / 2, z0 + AD / 2, dark, true);
        // Chunky stepped pillar faces at the alcove mouth
        texturedBox(4.4, aTop + 2, 3.2, s * (wallX + 0.4), (aTop + 2) / 2, z0 + 0.6, studPlateMaterial('#625d7a', 2, 8), true);
        for (let k = 0; k < 6; k++) box(1, 1, 3.4, s * (wallX + 2.6), 3 + k * 3.8, z0 + 0.6, 0x4a4660, { decor: true });
        blob(s * (wallX + 2.8), 15, z0 - 1, 1.1);
        blob(s * (wallX + 2.8), 27.5, z0 - 1, 1.2);
    }
    texturedBox(wallX * 2 + 3, 2, AD, 0, aTop + 1, z0 + AD / 2, dark, false);
    // Fascia above the mouth with the purple New Year banner and the big 2026
    texturedBox(wallX * 2 + 8, WALLH - aTop, 3, 0, aTop + (WALLH - aTop) / 2, z0 - 0.2, studPlateMaterial('#4a4660', 10, 4), true);
    box(36, 5, 1, 0, aTop + 3.6, z0 - 2.2, 0x6a2fd0, { decor: true });
    box(37, 0.6, 1.2, 0, aTop + 1.1, z0 - 2.2, 0xffd028, { neon: true, decor: true });
    box(37, 0.6, 1.2, 0, aTop + 6.1, z0 - 2.2, 0xffd028, { neon: true, decor: true });
    textPlane([{ t: '🎉 HAPPY NEW YEARS! 🎉', c: '#ffd028', s: '#3a1490', px: 110 }], 34, 1024, new V3(0, aTop + 3.6, z0 - 2.8), new V3(0, aTop + 3.6, z0 - 20));
    textPlane([{ t: '2026', c: '#ffe14a', s: '#ffffff', px: 220 }], 22, 1024, new V3(0, aTop + 10.5, z0 - 1.9), new V3(0, aTop + 10.5, z0 - 20));
    for (const s of [-1, 1]) {
        rocket(s * 16, aTop + 6, z0 - 3, s * -0.75);
        rocket(s * 26, aTop + 2, z0 - 3, s * -0.4);
    }
    // Inside the alcove: brown floor, the red carpet running in, a hanging tube lamp
    texturedBox(wallX * 2 - 3, 0.12, AD, 0, 0.06, z0 + AD / 2, brickMaterial(0x93604e, 5, 3), false);
    tubeLamp(0, aTop - 3.5, z0 + AD / 2, 10);
    // Red carpet with chevrons from the spawn all the way into the gate
    box(12, 0.5, HZ - SPAWN.z - 4, 0, 0.45, (SPAWN.z + 4 + HZ) / 2, C.carpet, { decor: true });
    for (let z = SPAWN.z + 14; z < HZ - 4; z += 8) floorArrow(0, 0.72, z, 0xb3122a, 3);
    const sp = new T.Mesh(new T.CylinderGeometry(6, 6, 0.3, 40), mat(0xf6f6fa));
    sp.position.set(SPAWN.x, 0.55, SPAWN.z); scene.add(sp);

    // AUTO RUN treadmills (west) with the leaderboards hanging on the wall above them
    const bc = document.createElement('canvas'); bc.width = 64; bc.height = 64;
    const bx = bc.getContext('2d');
    bx.fillStyle = '#26232e'; bx.fillRect(0, 0, 64, 64);
    bx.fillStyle = '#3a3646'; for (let i = 0; i < 4; i++) bx.fillRect(0, i * 16, 64, 6);
    beltTex = texFrom(bc); beltTex.wrapS = beltTex.wrapT = T.RepeatWrapping; beltTex.repeat.set(1, 4);
    TREADMILLS.forEach((def, i) => buildTreadmill(def, TREAD_GEO.x0 + i * TREAD_GEO.step, TREAD_GEO.top, TREAD_GEO.z, rng));
    boards.wins = leaderboard(new V3(-66, 23, HZ - 2.2), ['TOP', 'WINS']);
    boards.playtime = leaderboard(new V3(-50, 23, HZ - 2.2), ['TOP', 'PLAYTIME']);
    boards.steps = leaderboard(new V3(-34, 23, HZ - 2.2), ['TOP', 'STEPS']);

    buildStairs();
    buildPortals();
    buildWestWing();

    // New Year decorations
    tree(-62, -56, 1.3); tree(62, -56, 1.2); tree(-75, -20, 1.1); tree(-24, -40, 0.9);
    present(-56, -50, 1, 0xe2263f, 0xffd028); present(-52, -54, 0.8, 0x3cc8ff, 0xffffff); present(-20, -36, 0.9, 0x46ec50, 0xe2263f);
    present(56, -50, 0.7, 0xffd028, 0xc428ff); present(30, -10, 1, 0xc428ff, 0xffd028); present(-16, 48, 0.8, 0xff8fd0, 0xffffff);
    present(16, 50, 0.9, 0xe2263f, 0xffffff); present(19, 47, 0.7, 0x3cc8ff, 0xffd028);
    rocket(HX - 3, 0, -30, 0.2); rocket(-HX + 3, 0, -36, -0.2);
}

// =====================================================================================
// Stage screens: the glowing blue "Stage N" glass you walk through into the next stage
// =====================================================================================
const SCR_W = 30, SCR_H = 24, screens = [];
// Row of shadow monster faces printed on a stage screen (how many wait in that stage)
function monsterFaces(n) {
    const c = document.createElement('canvas'); c.width = 128 * n; c.height = 128;
    const x = c.getContext('2d');
    for (let k = 0; k < n; k++) {
        const cx = 64 + k * 128;
        x.fillStyle = 'rgba(20,40,70,0.9)';
        for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI; x.beginPath(); x.arc(cx + Math.cos(a) * 40, 60 + Math.sin(a) * 40, 14, 0, Math.PI * 2); x.fill(); }
        x.beginPath(); x.arc(cx, 66, 44, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#ffffff';
        x.beginPath(); x.moveTo(cx - 28, 72); x.quadraticCurveTo(cx, 108, cx + 28, 72); x.quadraticCurveTo(cx, 86, cx - 28, 72); x.fill();
        x.fillRect(cx - 22, 48, 14, 6); x.fillRect(cx + 8, 48, 14, 6);
    }
    return texFrom(c);
}
function stageScreen(z, label, faces) {
    const half = W / 2, open = SCR_W / 2;
    // Wall around the screen (solid); the glass itself is walk-through
    for (const s of [-1, 1]) texturedBox(half - open, CH, 2, s * (open + (half - open) / 2), CH / 2, z, brickMaterial(C.hallWall, 1, 4), true);
    texturedBox(SCR_W, CH - SCR_H, 2, 0, SCR_H + (CH - SCR_H) / 2, z, brickMaterial(C.hallWall, 3, 1), true);
    // Light-blue frame with yellow jagged corners
    for (const s of [-1, 1]) box(1.6, SCR_H, 1.6, s * (open - 0.8), SCR_H / 2, z - 1.2, C.screenEdge, { neon: true, decor: true });
    box(SCR_W, 1.6, 1.6, 0, SCR_H - 0.8, z - 1.2, C.screenEdge, { neon: true, decor: true });
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, 0.42], [1, 0.42]]) {
        const j = new T.Mesh(new T.ConeGeometry(1.4, 3, 3), mat(C.jag, { neon: true }));
        j.position.set(sx * (open - 1), SCR_H * sy - 1.5, z - 1.6); j.rotation.z = sx * 2.2; scene.add(j);
    }
    const m = new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            uniform float uTime, uFade; varying vec2 vUv;
            void main() {
                float streak = pow(0.5 + 0.5 * sin((vUv.x * 1.6 + vUv.y) * 9.0 - uTime * 1.4), 10.0);
                float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.05, vUv.y);
                vec3 col = mix(vec3(0.16, 0.55, 1.0), vec3(0.62, 0.9, 1.0), vUv.y * 0.6) + streak * 0.35;
                float a = (0.45 + streak * 0.3) * edge * uFade;
                gl_FragColor = vec4(col, a);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false,
    });
    const glass = new T.Mesh(new T.PlaneGeometry(SCR_W - 3.2, SCR_H - 1.6), m);
    glass.position.set(0, (SCR_H - 1.6) / 2, z - 1.25); scene.add(glass);
    const text = textPlane([{ t: label, c: '#ffffff', s: '#1f5fd8', px: 190 }], SCR_W - 4, 1024, new V3(0, SCR_H - 7.5, z - 1.4), new V3(0, SCR_H - 7.5, z - 20));
    if (faces) {
        const f = new T.Mesh(new T.PlaneGeometry(faces * 3.2, 3.2), new T.MeshBasicMaterial({ map: monsterFaces(faces), transparent: true, toneMapped: false, depthWrite: false }));
        f.position.set(0, SCR_H - 13.5, z - 1.35); f.rotation.y = Math.PI; scene.add(f);
    }
    screens.push({ m, z, text });
}
export function updateScreens(t) {
    for (const s of screens) {
        s.m.uniforms.uTime.value = t;
        // Fade out when the camera is right at the glass so it does not fill the view
        const d = Math.abs(camera.position.z - s.z);
        const f = clamp((d - 2) / 14, 0.15, 1);
        s.m.uniforms.uFade.value = f;
        s.text.material.opacity = f;
    }
}

// =====================================================================================
// Stage corridors
// =====================================================================================
function winPad(x, z, color, top, bottom, onEnter) {
    const pad = new T.Mesh(UNIT, mat(color, { neon: true }));
    pad.scale.set(9, 0.6, 7); pad.position.set(x, 0.3, z); scene.add(pad);
    box(9.6, 0.4, 7.6, x, 0.2, z, 0x16121f, { decor: true });
    billboard([{ t: top, c: '#ffffff', s: '#16121f', px: 44 }, { t: bottom, c: '#ffd028', s: '#16121f', px: 80 }], 9, 512, new V3(x, 7, z));
    const tr = aabb(x, 2.5, z, 9, 5, 7);
    tr.enter = onEnter;
    triggers.push(tr);
}
function recSign(x, z, n) {
    box(0.6, 6, 0.6, x, 3, z, 0x8a3a20, { decor: true });
    const g = new T.Mesh(UNIT, mat(0xe8562a)); g.scale.set(8, 4.6, 0.6); g.position.set(x, 7.5, z); scene.add(g);
    textPlane([{ t: 'Clones', c: '#ffffff', s: '#7a1e0e', px: 70 }, { t: 'Recommended:', c: '#ffffff', s: '#7a1e0e', px: 60 }, { t: String(n), c: '#ffffff', s: '#7a1e0e', px: 70 }],
        7.4, 512, new V3(x, 7.5, z - 0.35), new V3(x, 7.5, z - 10));
}
function buildStage(i, s) {
    const rng = rngFrom(300 + i * 31);
    const len = s.len, mid = s.zS + len / 2, half = W / 2;
    const th = THEMES[s.theme] || THEMES.hall;
    const crates = s.theme === 'hall' || s.theme === 'shadow' || s.theme === 'boss';
    for (const sx of [-1, 1]) {
        texturedBox(2, CH, len, sx * (half + 1), CH / 2, mid, brickMaterial(th.wall, len / 14, CH / 10), true);
        box(0.4, 1.2, len, sx * (half - 0.2), 9, mid, C.hallPanel, { decor: true });
        for (let z = s.zS + 14; z < s.zE - 4; z += 26) {
            box(2.4, CH, 2.4, sx * (half - 0.6), CH / 2, z, C.hallBeam, { decor: true });
            if (crates && rng() < 0.6) {
                const cm = new T.Mesh(UNIT, crateMaterial());
                cm.scale.set(1, 2.6 + rng() * 1.5, 5); cm.position.set(sx * (half - 0.4), 5 + rng() * 10, z + 9 + rng() * 6); scene.add(cm);
            }
        }
    }
    box(W + 4, 2, len, 0, CH + 1, mid, th.ceil, { decor: true });
    if (s.theme !== 'shadow') for (let z = s.zS + 10; z < s.zE; z += 20) for (const sx of [-1, 1]) {
        const l = box(0.6, 0.3, 8, sx * 8, CH - 0.2, z, th.light, { neon: true, decor: true });
        l.rotation.y = sx * 0.5; l.updateMatrix();
    }
    // The monsters wait in a row near the far end of the room
    s.spots = [];
    for (let k = 0; k < s.monsters; k++) {
        const f = s.monsters === 1 ? 0.5 : k / (s.monsters - 1);
        s.spots.push({ x: (f * 2 - 1) * (half - 7), z: s.cE - 18 - (k % 2) * 6 });
    }
    buildStageTheme(i, s);
    // End zone: +Wins pads either side and the next stage's screen ahead
    const last = i === STAGES.length - 1;
    const pz = s.cE + 18;
    winPad(-10, pz, 0x2a8cff, '~x2 WINS~', '+' + s.wins * 2 + ' Wins 🏆', () => actions.pad(i, true));
    winPad(10, pz, 0xffd028, '~TOUCH FOR~', '+' + s.wins + (s.wins === 1 ? ' Win' : ' Wins') + ' 🏆', () => actions.pad(i, false));
    if (!last) {
        recSign(-16, s.zE - 6, STAGES[i + 1].rec);
        stageScreen(s.zE, STAGES[i + 1].name, STAGES[i + 1].monsters);
    } else {
        texturedBox(W + 4, CH, 2, 0, CH / 2, s.zE + 1, starMaterial(true, 2, 2), true);
        textPlane([{ t: 'YOU ESCAPED!', c: '#ffd028', s: '#16121f', px: 150 }, { t: 'More stages coming soon', c: '#ffffff', s: '#16121f', px: 70 }],
            32, 1024, new V3(0, 20, s.zE - 0.2), new V3(0, 20, s.zE - 20));
    }
    const tr = aabb(0, 15, s.zS + 3, W, 30, 2);
    tr.enter = () => actions.enterStage(i);
    triggers.push(tr);
}

function buildCourse() {
    stageScreen(STAGES[0].zS, STAGES[0].name);
    STAGES.forEach((s, i) => buildStage(i, s));
}

// Billboards that depend on this player's unlocks
export function refreshWorld() {
    for (const t of treadItems) {
        const sig = (treadLocked(t.def) ? 'l' : 'u') + (t.def.pass ? PASSES[t.def.pass].price : '');
        if (sig !== t.sig) { t.sig = sig; t.sp.userData.set(treadLines(t.def)); }
    }
    for (const l of limitItems) {
        const state = S.limits[l.i] ? 'o' : 'l';
        if (state !== l.sig) { l.sig = state; l.pad.material = padMat(state === 'o' ? C.padOwned : C.pad); }
    }
    for (const it of portalItems) {
        const sig = it.p.soon ? 's' : portalOpen(it.p, S.portals) ? 'o' : 'l';
        if (sig === it.sig) continue;
        it.sig = sig;
        it.sp.userData.set(portalLines(it.p));
        if (it.lock) it.lock.visible = sig !== 'o';
    }
}

export function buildWorld() {
    buildLobby();
    buildCourse();
    refreshWorld();
}
