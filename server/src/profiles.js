import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Player progress keyed by a per-browser id. A JSON file is enough for the demo;
// swap this module for the platform's database/auth when it goes live on Bloxity.
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');

const profiles = new Map();
let dirty = false;

try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [uid, p] of Object.entries(raw)) profiles.set(uid, p);
    console.log(`Loaded ${profiles.size} profiles`);
} catch (e) {
    if (e.code !== 'ENOENT') console.warn('Could not read profiles:', e.message);
}

export function defaultProfile(uid, name) {
    return {
        uid, name,
        steps: 0, wins: 0, totalWins: 0, level: 1, xp: 0, rebirths: 0, playtime: 0, best: 0,
        limits: {}, portals: {}, passes: {}, quest: 0,
        boostUntil: 0, claimedPack: false, seenTutorial: false,
        firstPlay: Date.now(),
    };
}

// A blank name keeps the saved one; new players without a name get a random one
export function getProfile(uid, name, fallbackName) {
    let p = profiles.get(uid);
    if (!p) {
        p = defaultProfile(uid, name || fallbackName);
        profiles.set(uid, p);
    } else {
        // Reconcile profiles saved by older versions
        p = Object.assign(defaultProfile(uid, name), p);
        profiles.set(uid, p);
    }
    if (name) p.name = name;
    dirty = true;
    return p;
}

export function hasProfile(uid) { return profiles.has(uid); }
// First Bloxity login on a browser that already played as a guest keeps that progress
export function adoptGuestProgress(legionUid, guestUid, name) {
    if (profiles.has(legionUid) || !guestUid || !profiles.has(guestUid)) return;
    const g = profiles.get(guestUid);
    profiles.set(legionUid, { ...JSON.parse(JSON.stringify(g)), uid: legionUid, name: name || g.name });
    dirty = true;
}

export function markDirty() { dirty = true; }
export function allProfiles() { return profiles.values(); }

export function saveProfiles() {
    if (!dirty) return;
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(profiles)));
        fs.renameSync(tmp, FILE);
        dirty = false;
    } catch (e) {
        console.warn('Could not save profiles:', e.message);
    }
}

// Rooms also save on dispose (Colyseus disposes rooms during a graceful shutdown)
setInterval(saveProfiles, 30000).unref();
