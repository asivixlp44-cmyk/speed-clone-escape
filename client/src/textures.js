import { T, texFrom } from './engine.js';

// Canvas-generated surface textures: bricks, lobby tiles, star walls and XXX crates.

function canvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h || w;
    draw(c.getContext('2d'), c.width, c.height);
    return c;
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// Running-bond bricks in light greys; the material colour tints them
const brickImg = canvas(128, 128, (x) => {
    x.fillStyle = '#b9b3c9'; x.fillRect(0, 0, 128, 128);
    const rows = 8, h = 128 / rows, w = 32;
    for (let r = 0; r < rows; r++) {
        const off = r % 2 ? w / 2 : 0;
        for (let b = -1; b < 128 / w + 1; b++) {
            const v = Math.round(225 + rnd() * 30);
            x.fillStyle = `rgb(${v},${v},${Math.min(255, v + 8)})`;
            x.fillRect(b * w + off + 1.5, r * h + 1.5, w - 3, h - 3);
            x.fillStyle = 'rgba(255,255,255,0.18)';
            x.fillRect(b * w + off + 1.5, r * h + 1.5, w - 3, 2);
        }
    }
});
// Lobby floor: lavender plates with a pale chevron, like the reference lobby
const tileImg = canvas(128, 128, (x) => {
    x.fillStyle = '#b6a8ec'; x.fillRect(0, 0, 128, 128);
    for (const [ox, oy] of [[0, 0], [64, 64]]) {
        x.fillStyle = '#c7bcf4'; x.fillRect(ox + 2, oy + 2, 60, 60);
        x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 5; x.lineJoin = 'round';
        x.beginPath(); x.moveTo(ox + 18, oy + 26); x.lineTo(ox + 32, oy + 40); x.lineTo(ox + 46, oy + 26); x.stroke();
    }
    x.fillStyle = '#a495e2'; x.fillRect(64, 0, 64, 64); x.fillRect(0, 64, 64, 64);
    x.strokeStyle = 'rgba(70,50,140,0.35)'; x.lineWidth = 2; x.strokeRect(1, 1, 126, 126); x.strokeRect(64, 0, 0.1, 128); x.strokeRect(0, 64, 128, 0.1);
});
function star(x, cx, cy, r) {
    x.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath(); x.fill();
}
// New Year wall panels: red or navy with scattered white stars
function starImg(bg) {
    return canvas(256, 256, (x, w, h) => {
        x.fillStyle = bg; x.fillRect(0, 0, w, h);
        x.fillStyle = '#ffffff';
        star(x, 70, 60, 26); star(x, 190, 150, 18); star(x, 90, 200, 14); star(x, 210, 40, 10);
    });
}
const redStars = starImg('#e2263f'), navyStars = starImg('#1f2244');
// Wall crates with "XXX" on them (stage corridors)
const crateImg = canvas(128, 64, (x, w, h) => {
    x.fillStyle = '#e8562a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#b8381a'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    x.font = '700 40px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#ffb07a'; x.fillText('XXX', w / 2, h / 2 + 2);
});

// Stage floors: brown bricks or lavender studs, both with the Roblox-style chevron engraving
function chevron(x, ox, oy, s, color) {
    x.strokeStyle = color; x.lineWidth = s * 0.16; x.lineJoin = 'round'; x.lineCap = 'round';
    x.beginPath(); x.moveTo(ox - s * 0.35, oy - s * 0.15); x.lineTo(ox, oy + s * 0.2); x.lineTo(ox + s * 0.35, oy - s * 0.15); x.stroke();
}
const brickFloorImg = canvas(128, 128, (x) => {
    x.fillStyle = '#6e3e30'; x.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 4; r++) for (let b = -1; b < 3; b++) {
        const off = r % 2 ? 32 : 0, v = Math.round(rnd() * 14);
        x.fillStyle = 'rgb(' + (150 + v) + ',' + (92 + v) + ',' + (72 + v) + ')';
        x.fillRect(b * 64 + off + 2, r * 32 + 2, 60, 28);
        chevron(x, b * 64 + off + 32, r * 32 + 15, 18, 'rgba(90,48,36,0.55)');
    }
});
const studFloorImg = canvas(64, 64, (x) => {
    x.fillStyle = '#8c84bb'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = 'rgba(70,60,120,0.35)'; x.lineWidth = 2; x.strokeRect(1, 1, 62, 62);
    chevron(x, 32, 30, 30, 'rgba(225,220,255,0.45)');
});

const cache = new Map();
function repeated(img, key, rx, ry) {
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    const id = key + rx + 'x' + ry;
    if (cache.has(id)) return cache.get(id);
    const t = texFrom(img);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
    cache.set(id, t);
    return t;
}
function lambert(id, color, map) {
    id = 'mat:' + id;
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map });
    cache.set(id, m);
    return m;
}
export const brickMaterial = (color, rx, ry) => lambert('brick' + color + rx + 'x' + ry, color, repeated(brickImg, 'brick', rx, ry));
export const tileMaterial = (rx, ry) => lambert('tile' + rx + 'x' + ry, 0xffffff, repeated(tileImg, 'tile', rx, ry));
export const starMaterial = (navy, rx, ry) => lambert('star' + navy + rx + 'x' + ry, 0xffffff, repeated(navy ? navyStars : redStars, navy ? 'navy' : 'red', rx, ry));
export const brickFloorMaterial = (rx, ry) => lambert('bfloor' + rx + 'x' + ry, 0xffffff, repeated(brickFloorImg, 'bfloor', rx, ry));
export const studFloorMaterial = (rx, ry, tint) => lambert('sfloor' + (tint || '') + rx + 'x' + ry, tint || 0xffffff, repeated(studFloorImg, 'sfloor', rx, ry));
export const crateMaterial = () => lambert('crate', 0xffffff, texFrom(crateImg));

export function updateMaterials() { /* no animated surfaces in this game */ }

// Roblox-style stud plate for the lobby: lavender grey with an engraved "L" on every stud
const lobbyStudImg = canvas(64, 64, (x) => {
    x.fillStyle = '#958fc0'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = 'rgba(70,62,120,0.35)'; x.lineWidth = 2; x.strokeRect(1, 1, 62, 62);
    x.lineCap = 'square'; x.lineWidth = 5;
    x.strokeStyle = 'rgba(60,52,110,0.55)'; x.beginPath(); x.moveTo(22, 20); x.lineTo(22, 42); x.lineTo(42, 42); x.stroke();
    x.strokeStyle = 'rgba(205,200,240,0.6)'; x.beginPath(); x.moveTo(20, 18); x.lineTo(20, 40); x.lineTo(40, 40); x.stroke();
});
// Same stud with a custom base colour (stairs, alcove walls)
const studCache = new Map();
function tintedStudImg(base) {
    if (!studCache.has(base)) {
        studCache.set(base, canvas(64, 64, (x) => {
            x.fillStyle = base; x.fillRect(0, 0, 64, 64);
            x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 2; x.strokeRect(1, 1, 62, 62);
            x.lineCap = 'square'; x.lineWidth = 5;
            x.strokeStyle = 'rgba(0,0,0,0.28)'; x.beginPath(); x.moveTo(22, 20); x.lineTo(22, 42); x.lineTo(42, 42); x.stroke();
            x.strokeStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.moveTo(20, 18); x.lineTo(20, 40); x.lineTo(40, 40); x.stroke();
        }));
    }
    return studCache.get(base);
}
export const lobbyFloorMaterial = (rx, ry) => lambert('lobbyfloor' + rx + 'x' + ry, 0xffffff, repeated(lobbyStudImg, 'lobbystud', rx, ry));
export const studPlateMaterial = (base, rx, ry) => lambert('plate' + base + rx + 'x' + ry, 0xffffff, repeated(tintedStudImg(base), 'plate' + base, rx, ry));

// Treadmill belts: chunky colour and white stripes that scroll (one texture per colour)
export const beltTextures = [];
const beltCache = new Map();
export function beltMaterial(color, stripe) {
    const key = color + (stripe || "");
    if (beltCache.has(key)) return beltCache.get(key);
    const c = canvas(32, 64, (x) => {
        x.fillStyle = color; x.fillRect(0, 0, 32, 64);
        x.fillStyle = stripe || 'rgba(255,255,255,0.92)'; x.fillRect(0, 4, 32, 22); x.fillRect(0, 36, 32, 22);
        x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, 24, 32, 2); x.fillRect(0, 56, 32, 2);
    });
    const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1, 4);
    beltTextures.push(t);
    const m = new T.MeshLambertMaterial({ map: t });
    beltCache.set(key, m);
    return m;
}
