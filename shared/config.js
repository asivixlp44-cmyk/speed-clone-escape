// Game data shared by the client and the Colyseus server.
// Clone target: Roblox "+1 Clone Speed Escape" (reference/Gameplay.mp4).

export const CFG = {
    walkSpeed: 26,
    gainInterval: 0.4,      // seconds between Steps payouts while running
    baseCloneLimit: 3,
    plusClones: 3,          // "+3 Clones (permanent)" pass
    rebirthLevel: 25,
    rebirthStep: 0.5,
    courseWidth: 40,
    wallHeight: 34,
    voidY: -40,
    endZone: 44,
    boostMult: 2,
    boostMinutes: 15,
    reviveTimeout: 10,
    shieldTime: 2.5,
    starterPackDuration: 15 * 60,
    maxPlayers: 24,
    maxCloneModels: 24,     // clones drawn for the local player (the rest are counted)
    maxRemoteClones: 6,     // clones drawn for each other player
};

// Lvl 9 needs 2,430 Steps, Lvl 10 3,052, Lvl 11 3,780 in the reference
export const xpFor = (L) => Math.floor(30 * L * L * (1 + Math.max(0, L - 9) * 0.017));

// Clone limit pads on the lobby stairs: pay Wins once, the limit grows for good
export const LIMITS = [
    { cost: 3, add: 6 }, { cost: 15, add: 12 }, { cost: 100, add: 22 }, { cost: 500, add: 36 },
    { cost: 2500, add: 51 }, { cost: 15000, add: 66 }, { cost: 75000, add: 81 },
];
export function cloneLimit(p) {
    let n = CFG.baseCloneLimit;
    for (let i = 0; i < LIMITS.length; i++) if (p.limits && p.limits[i]) n += LIMITS[i].add;
    return n;
}
// One clone per level above 1, up to the limit, plus the permanent pass clones
export function ownedClones(p) {
    const fromLevels = Math.min(Math.max(0, (p.level || 1) - 1), cloneLimit(p));
    return fromLevels + (p.passes && p.passes.PlusClones ? CFG.plusClones : 0);
}

export const LOBBY = { halfX: 80, halfZ: 70, wallHeight: 40, spawn: { x: 0, y: 0.5, z: -20 } };

// Six themed stages. Shadow monsters eat one clone per bite (you, once the clones run out),
// and every theme adds its own hazard that eats clones the same way:
//   hall   - a warm-up run with Step gems, no danger
//   shadow - the reference room: a row of monsters at the far end
//   lava   - a winding bridge over lava with erupting geysers
//   spin   - spiked sweeper arms you jump over
//   laser  - sliding laser walls with a moving gap
//   boss   - a giant shadow boss chases you to the finish
export const STAGES = [
    { name: 'Stage 1', theme: 'hall', title: 'THE ESCAPE', len: 240, monsters: 0, mSpeed: 0, wake: 0, wins: 1, rec: 0, gem: 4, fog: 0x2a2440 },
    { name: 'Stage 2', theme: 'shadow', title: 'SHADOW HALL', len: 260, monsters: 4, mSpeed: 34, wake: 70, wins: 3, rec: 8, gem: 8, fog: 0x1e1838 },
    { name: 'Stage 3', theme: 'lava', title: 'LAVA BRIDGE', len: 300, monsters: 4, mSpeed: 34, wake: 60, wins: 8, rec: 15, gem: 15, fog: 0x3a1408 },
    { name: 'Stage 4', theme: 'spin', title: 'SPIN ZONE', len: 300, monsters: 4, mSpeed: 38, wake: 66, wins: 20, rec: 25, gem: 25, fog: 0x0c2a3a },
    { name: 'Stage 5', theme: 'laser', title: 'LASER GRID', len: 320, monsters: 5, mSpeed: 40, wake: 70, wins: 50, rec: 40, gem: 40, fog: 0x0a0a22 },
    { name: 'Stage 6', theme: 'boss', title: 'THE BOSS', len: 380, monsters: 3, mSpeed: 42, wake: 60, wins: 120, rec: 60, gem: 60, fog: 0x2a060c },
];
{
    let z = LOBBY.halfZ;
    for (const s of STAGES) {
        s.zS = z;
        s.zE = z + s.len;
        s.cE = s.zE - CFG.endZone; // the end zone (win pads + next screen) starts here
        z = s.zE;
    }
}
export function stageAt(z) {
    for (let i = 0; i < STAGES.length; i++) if (z >= STAGES[i].zS && z < STAGES[i].zE) return i;
    return -1;
}

// Lobby stage portals: pay Wins once to unlock a shortcut to that stage (Stage 1 is free)
export const portalOpen = (p, unlocked) => !p.soon && (p.cost === 0 || !!(unlocked && unlocked[p.stage]));
export const PORTALS = [
    { stage: 1, cost: 0 }, { stage: 2, cost: 3 }, { stage: 3, cost: 15 }, { stage: 4, cost: 35 },
    { stage: 5, cost: 90 }, { stage: 6, cost: 250 }, { stage: 7, soon: true },
];

// AUTO RUN treadmills: stand on one and your character runs by itself
export const TREADMILLS = [
    { mult: 1 }, { mult: 1 }, { mult: 1 },
    { mult: 2, pass: 'GoldTread', name: 'Gold' },
    { mult: 5, pass: 'DiamondTread', name: 'Diamond' },
    { mult: 10, pass: 'CelestialTread', name: 'Celestial' },
];
export const TREAD_GEO = { x0: -68, step: 10, z: 30, top: 1.6, len: 16, width: 7 };
export function treadmillAt(x, y, z) {
    const g = TREAD_GEO;
    if (Math.abs(z - g.z) > g.len / 2 + 0.5 || y > g.top + 3 || y < g.top - 0.6) return null;
    for (let i = 0; i < TREADMILLS.length; i++) {
        if (Math.abs(x - (g.x0 + i * g.step)) <= g.width / 2 + 0.3) return TREADMILLS[i];
    }
    return null;
}

export const PRODUCTS = {
    Steps10K: { name: '+10K Steps', price: 29, steps: 10000 },
    Steps100K: { name: '+100K Steps', price: 79, steps: 100000 },
    Steps1M: { name: '+1M Steps', price: 149, steps: 1000000 },
    StarterPack: { name: 'Starter Pack', price: 19, steps: 20000, wins: 10 },
    Revive: { name: 'Revive', price: 9 },
    StepsBoost: { name: 'x2 Steps Boost (15 min)', price: 49 },
};
export const PASSES = {
    PlusClones: { name: '+3 Clones', price: 19, ic: '👥', desc: 'Permanent: 3 extra clones that ignore the limit' },
    DoubleSteps: { name: 'x2 Steps', price: 39, ic: '👟', desc: 'Double all Steps you earn' },
    GoldTread: { name: 'Gold Treadmill', price: 25, ic: '🟨', desc: 'Unlocks the x2 AUTO RUN treadmill' },
    DiamondTread: { name: 'Diamond Treadmill', price: 99, ic: '💎', desc: 'Unlocks the x5 AUTO RUN treadmill' },
    CelestialTread: { name: 'Celestial Treadmill', price: 225, ic: '🌌', desc: 'Unlocks the x10 AUTO RUN treadmill' },
    DoubleWins: { name: 'x2 Wins', price: 139, ic: '🏆', desc: 'Double Wins from every stage' },
};
// Bloxity Bux SKUs: create these in the game's IAP catalog on bloxity.io (prices live there)
export const SKUS = {
    product: {
        Steps10K: 'steps_10k', Steps100K: 'steps_100k', Steps1M: 'steps_1m',
        StarterPack: 'starter_pack', Revive: 'revive', StepsBoost: 'steps_boost',
    },
    pass: {
        PlusClones: 'pass_plus_clones', DoubleSteps: 'pass_double_steps', GoldTread: 'pass_gold_treadmill',
        DiamondTread: 'pass_diamond_treadmill', CelestialTread: 'pass_celestial_treadmill', DoubleWins: 'pass_double_wins',
    },
};
// Bux price label for 3D text (DOM uses the coin icon instead)
export const buxText = (n) => fmt(n) + ' Bux';
export function skuLookup(sku) {
    for (const kind of ['product', 'pass']) for (const [key, s] of Object.entries(SKUS[kind])) if (s === sku) return { kind, key };
    return null;
}

// Quest chain shown at the top of the screen ("Get 3 Wins! (1/3)")
export const QUESTS = [
    { text: 'Get 3 Wins!', stat: 'totalWins', n: 3, reward: { steps: 1000 } },
    { text: 'Reach Level 10!', stat: 'level', n: 10, reward: { wins: 2 } },
    { text: 'Beat Stage 2!', stat: 'best', n: 2, reward: { steps: 5000 } },
    { text: 'Get 25 Wins!', stat: 'totalWins', n: 25, reward: { wins: 5 } },
    { text: 'Beat Stage 4!', stat: 'best', n: 4, reward: { steps: 50000 } },
    { text: 'Reach Level 25!', stat: 'level', n: 25, reward: { wins: 15 } },
    { text: 'Rebirth once!', stat: 'rebirths', n: 1, reward: { wins: 25 } },
    { text: 'Beat Stage 6!', stat: 'best', n: 6, reward: { wins: 100 } },
    { text: 'Get 1,000 Wins!', stat: 'totalWins', n: 1000, reward: { steps: 1000000 } },
];

// Session playtime rewards (minutes since joining)
export const FREE = [
    { min: 2, steps: 500 }, { min: 5, wins: 2 }, { min: 10, steps: 5000 },
    { min: 15, wins: 5 }, { min: 25, steps: 25000 }, { min: 40, wins: 15 },
];

// Fallback blocky look (before the Bloxity body loads): black tee, dark jeans, orange hair
export const KITS = [
    { shirt: 0x1c1c22, shorts: 0x26302a, socks: 0x26302a, hair: 0xe8761e, skin: 0xf2efe6 },
    { shirt: 0x2f7bff, shorts: 0x2b3340, socks: 0x2b3340, hair: 0x3a2618 },
    { shirt: 0xe82434, shorts: 0x1c1c22, socks: 0x1c1c22, hair: 0x1a1410 },
    { shirt: 0x28c43c, shorts: 0x2b3340, socks: 0x2b3340, hair: 0xe6c878 },
    { shirt: 0x8a1cff, shorts: 0x1c1c22, socks: 0x1c1c22, hair: 0x3a2618 },
    { shirt: 0xf5f5f5, shorts: 0x2b3340, socks: 0x2b3340, hair: 0xd8641e },
];
export const SKINS = [0xf5d29a, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0xf0c8a0];

// Combined multiplier for earned Steps: rebirths, x2 pass, timed boost
export function stepsMult(p, now) {
    let m = 1 + (p.rebirths || 0) * CFG.rebirthStep;
    if (p.passes && p.passes.DoubleSteps) m *= 2;
    if ((now || Date.now()) < (p.boostUntil || 0)) m *= CFG.boostMult;
    return m;
}

const SUF = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
// 2700 -> "2.7K", 1000000 -> "1M", 950 -> "950"
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    let i = -1, s = v;
    while (s >= 1000 && i < SUF.length - 1) { s /= 1000; i++; }
    const t = s >= 100 ? String(Math.floor(s)) : (Math.floor(s * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return t + SUF[i];
}
// 7946 -> "7,946" (HUD counters in the reference use separators)
export const comma = (v) => Math.floor(v || 0).toLocaleString('en-US');
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function hours(s) {
    s = Math.floor(s || 0);
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
