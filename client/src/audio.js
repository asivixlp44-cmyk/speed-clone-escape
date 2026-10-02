// Procedural soundtrack and sound effects (Web Audio, no asset files).
// The track is an original 124 BPM stadium anthem: I–V–vi–IV in C with a
// chant-style lead, 16 bars that loop through groove, hook, breakdown and drop.

let ctx = null, master, musicBus, sfxBus, reverb, delay, crowdGain;
let noiseBuf = null;
let musicOn = false, schedTimer = null, step = 0, nextTime = 0;
const settings = { music: 0.6, sfx: 0.8, master: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('sce_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 124, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// Chord roots and triads (MIDI), one chord per bar: C, G, Am, F
const CHORDS = [
    { root: 36, notes: [60, 64, 67] },
    { root: 43, notes: [59, 62, 67] },
    { root: 45, notes: [57, 60, 64] },
    { root: 41, notes: [57, 60, 65] },
];
// Chant hook, 4 bars x 16 steps: [step, midi, length in steps]
const HOOK = [
    [[0, 76, 3], [4, 79, 3], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
    [[0, 74, 3], [4, 71, 3], [8, 74, 2], [10, 79, 6]],
    [[0, 76, 3], [4, 72, 3], [8, 76, 2], [10, 77, 2], [12, 79, 4]],
    [[0, 77, 3], [4, 76, 2], [6, 74, 2], [8, 72, 8]],
];

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    comp.connect(master).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Shared reverb (generated impulse) and a dotted-eighth echo for the arp
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.28;
    reverb.connect(revGain).connect(musicBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    delay.connect(dlGain).connect(musicBus);

    startCrowd();
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicBus.gain.setTargetAtTime(settings.music * 0.55 * m, t, 0.05);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
    if (crowdGain) crowdGain.gain.setTargetAtTime(0, t, 0.2);
}
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('sce_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ }
    applyVolumes();
}

// ----- instruments -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
}
function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.35);
}
function clap(t, gain) {
    for (let i = 0; i < 3; i++) noise(t + i * 0.011, i === 2 ? 0.16 : 0.03, 'bandpass', 1400, 1.2, (gain || 0.5), musicBus);
    const g = noise(t + 0.02, 0.2, 'bandpass', 1600, 0.8, 0.12, reverb);
    return g;
}
function hat(t, open) { noise(t, open ? 0.14 : 0.035, 'highpass', 7500, 0.7, open ? 0.16 : 0.12); }
function bass(t, n, dur) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = midi(n);
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + dur); f.Q.value = 6;
    env(g, t, 0.005, 0.32, dur * 0.8, 0.12, 0.04, t + dur);
    o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + dur + 0.1);
}
function pad(t, notes, dur, open) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(open ? 2600 : 900, t); f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.25);
    g.gain.setValueAtTime(0.06, t + dur - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    // Sidechain-style pump on every beat
    for (let b = 1; b < 4; b++) { const bt = t + b * STEP * 4; g.gain.setValueAtTime(0.02, bt); g.gain.linearRampToValueAtTime(0.06, bt + STEP * 2.5); }
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const n of notes) for (const det of [-9, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.4);
    }
}
function pluck(t, n, cutoff) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = midi(n);
    f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(f).connect(g); g.connect(musicBus); g.connect(delay);
    o.start(t); o.stop(t + 0.25);
}
function lead(t, n, dur) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 3200; f.Q.value = 2;
    env(g, t, 0.02, 0.085, 0.1, 0.06, 0.12, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 5.5; vg.gain.value = 9; vib.connect(vg);
    for (const [type, det] of [['sawtooth', -6], ['sawtooth', 6], ['square', 0]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(n); o.detune.value = det;
        vg.connect(o.detune);
        o.connect(f); o.start(t); o.stop(t + dur + 0.2);
    }
    vib.start(t); vib.stop(t + dur + 0.2);
}
function riser(t, dur) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + dur);
    src.connect(f).connect(g).connect(musicBus); src.start(t); src.stop(t + dur);
}

// One 16th-note step of the song
function playStep(s, t) {
    const bar = Math.floor(s / 16) % 16, i = s % 16, chord = CHORDS[bar % 4];
    const breakdown = bar >= 8 && bar < 12;
    const hookOn = (bar >= 4 && bar < 8) || bar >= 12;
    if (!breakdown && i % 4 === 0) kick(t);
    if (breakdown && bar === 11 && i >= 8) { if (i % 2 === 0) clap(t, 0.25 + (i - 8) * 0.04); }
    else if (i === 4 || i === 12) clap(t);
    if (!breakdown) hat(t, i % 4 === 2);
    else if (i % 4 === 2) hat(t, false);
    if (!breakdown && i % 2 === 0) {
        const pattern = [0, 0, 12, 0, 0, 12, 0, 7];
        bass(t, chord.root + pattern[(i / 2) % 8], STEP * 1.8);
    }
    if (i === 0) pad(t, chord.notes, STEP * 16, bar >= 12);
    const tones = chord.notes.concat(chord.notes.map((n) => n + 12));
    const cutoff = breakdown ? 600 + (bar - 8) * 900 + i * 60 : 2400;
    pluck(t, tones[(i * 5) % tones.length] + 12, cutoff);
    if (hookOn) for (const [st, n, l] of HOOK[bar % 4]) if (st === i) lead(t, n, STEP * l);
    if (bar === 11 && i === 0) riser(t, STEP * 16);
}

function scheduler() {
    while (nextTime < ctx.currentTime + 0.12) {
        playStep(step, nextTime);
        nextTime += STEP;
        step++;
    }
}
export function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 25);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// ----- crowd ambience -----
function startCrowd() {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.15; lg.gain.value = 250; lfo.connect(lg).connect(f.frequency);
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0;
    src.connect(f).connect(crowdGain).connect(sfxBus);
    src.start(); lfo.start();
    applyVolumes();
}

// ----- sound effects -----
function tone(t, type, f0, f1, dur, gain, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
    click(t) { tone(t, 'triangle', 900, 500, 0.06, 0.25); },
    jump(t) { tone(t, 'sine', 260, 620, 0.14, 0.25); },
    land(t) { noise(t, 0.12, 'lowpass', 500, 1, 0.35, sfxBus); tone(t, 'sine', 120, 60, 0.1, 0.3); },
    step(t) { noise(t, 0.05, 'bandpass', 900 + Math.random() * 400, 2, 0.06, sfxBus); },
    pickup(t) { tone(t, 'sine', midi(84), null, 0.12, 0.3); tone(t + 0.07, 'sine', midi(91), null, 0.22, 0.3); },
    gain(t) { tone(t, 'triangle', midi(79), null, 0.08, 0.12); },
    hit(t) { tone(t, 'sine', 180, 50, 0.25, 0.7); noise(t, 0.25, 'lowpass', 1200, 1, 0.5, sfxBus); },
    death(t) { tone(t, 'sawtooth', 420, 60, 0.7, 0.25); noise(t, 0.5, 'lowpass', 800, 1, 0.3, sfxBus); },
    whistle(t) {
        const o = ctx.createOscillator(), g = ctx.createGain(), trill = ctx.createOscillator(), tg = ctx.createGain();
        o.frequency.value = 2900; trill.frequency.value = 38; tg.gain.value = 120;
        trill.connect(tg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.setValueAtTime(0.18, t + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(g).connect(sfxBus); o.start(t); trill.start(t); o.stop(t + 0.6); trill.stop(t + 0.6);
    },
    levelUp(t) { [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.08, 'square', midi(n), null, 0.25, 0.12)); tone(t + 0.32, 'triangle', midi(88), null, 0.6, 0.2); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.16)); },
    whoosh(t) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        src.connect(f).connect(g).connect(sfxBus); src.start(t); src.stop(t + 0.55);
    },
    cheer(t) {
        // Crowd roar swell + whistle
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
        src.connect(f).connect(g).connect(sfxBus); src.start(t); src.stop(t + 2.9);
        [72, 76, 79, 84, 88].forEach((n, i) => tone(t + 0.1 + i * 0.07, 'square', midi(n), null, 0.3, 0.08));
    },
    gate(t) {
        [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.09));
        tone(t, 'triangle', 220, 880, 0.35, 0.12);
    },
    // Shadow monster: low growl when it wakes, a crunch when it eats a clone
    roar(t) {
        tone(t, 'sawtooth', 110, 55, 0.7, 0.22);
        tone(t, 'square', 82, 41, 0.6, 0.12);
        noise(t, 0.6, 'lowpass', 400, 1, 0.35, sfxBus);
    },
    chomp(t) {
        noise(t, 0.08, 'bandpass', 1800, 1.5, 0.5, sfxBus);
        noise(t + 0.09, 0.1, 'bandpass', 1300, 1.5, 0.45, sfxBus);
        tone(t, 'sine', 160, 60, 0.2, 0.4);
    },
    poof(t) { noise(t, 0.3, 'highpass', 1500, 0.7, 0.3, sfxBus); tone(t, 'sine', 700, 1400, 0.15, 0.1); },
    clone(t) { [67, 74, 79].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.2, 0.14)); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.06); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.35, sfxBus); },
};
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}
