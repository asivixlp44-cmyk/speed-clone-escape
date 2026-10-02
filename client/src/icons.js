// Chunky outlined HUD icons drawn as inline SVG (trophy, gift, sneakers, clone heads...).
// Elements with data-icon="name" get the matching SVG when the page loads.
const K = '#16121f';
export const ICONS = {
    trophy: `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M17 13H7c0 11 6 16 13 16M47 13h10c0 11-6 16-13 16" fill="none" stroke="${K}" stroke-width="8" stroke-linecap="round"/>
        <path d="M17 13H7c0 11 6 16 13 16M47 13h10c0 11-6 16-13 16" fill="none" stroke="#ffb51c" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M16 6h32v16c0 11-7 18-16 18S16 33 16 22z" fill="#ffc72a" stroke="${K}" stroke-width="3.5"/>
        <path d="M22 11v10c0 6 4 11 8 12" fill="none" stroke="#fff1a8" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M27 39h10v8H27z" fill="#e3940c" stroke="${K}" stroke-width="3.5"/>
        <rect x="16" y="46" width="32" height="11" rx="3" fill="#ffc72a" stroke="${K}" stroke-width="3.5"/></svg>`,
    rebirth: `<svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="#ffffff" stroke="${K}" stroke-width="4"/>
        <path d="M6 32a26 26 0 0 1 52 0z" fill="#e82434" stroke="${K}" stroke-width="4"/>
        <path d="M6 32h52" stroke="${K}" stroke-width="5"/>
        <circle cx="32" cy="32" r="8" fill="#ffffff" stroke="${K}" stroke-width="4"/>
        <path d="M17 18a18 18 0 0 1 8-5" stroke="#ff9aa2" stroke-width="4" stroke-linecap="round" fill="none"/></svg>`,
    gift: `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 20c-4-10-16-12-16-5s10 6 16 5zm0 0c4-10 16-12 16-5s-10 6-16 5z" fill="#ffc72a" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <rect x="8" y="20" width="48" height="12" rx="2" fill="#ff4a5a" stroke="${K}" stroke-width="3.5"/>
        <rect x="12" y="31" width="40" height="27" rx="2" fill="#e82434" stroke="${K}" stroke-width="3.5"/>
        <path d="M27 20h10v38H27z" fill="#ffc72a" stroke="${K}" stroke-width="3.5"/>
        <path d="M15 35v18" stroke="#ff8a96" stroke-width="3" stroke-linecap="round"/></svg>`,
    shoeRed: `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M10 22c6 0 10-6 12-12 6 4 12 12 22 16 8 3 14 7 14 15v6H8c-2-8-2-18 2-25z" fill="#e82434" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M8 47h50v7H9z" fill="#ffffff" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M24 20l6 4M28 15l6 4" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
        <path d="M16 26c2 6 6 10 14 12" fill="none" stroke="#ff8a96" stroke-width="3" stroke-linecap="round"/></svg>`,
    shoeBlue: `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M6 40c4-1 8-6 9-12 8 2 14 8 24 9 9 1 17 3 19 9l-1 4H8z" fill="#2f8bff" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M6 44h52v6H8z" fill="#ffffff" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M22 32l4 4M28 33l3 4" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/></svg>`,
    clones: `<svg viewBox="0 0 80 64" aria-hidden="true">
        ${[[14, 30], [40, 24], [66, 30]].map(([x, y]) => `
        <rect x="${x - 11}" y="${y + 6}" width="22" height="20" rx="5" fill="#f5d29a" stroke="${K}" stroke-width="3"/>
        <path d="M${x - 13} ${y + 14}c-1-10 5-16 13-16s14 6 13 16c-3-5-7-7-13-7s-10 2-13 7z" fill="#e8761e" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="${x - 4}" cy="${y + 17}" r="1.8" fill="${K}"/><circle cx="${x + 4}" cy="${y + 17}" r="1.8" fill="${K}"/>
        <path d="M${x - 4} ${y + 21}q4 3 8 0" stroke="${K}" stroke-width="2" fill="none"/>`).join('')}
        <text x="40" y="17" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="20" fill="#ffd028" stroke="${K}" stroke-width="3" paint-order="stroke">+3</text></svg>`,
    treadGold: `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M6 42l30-14 22 8-30 15z" fill="#ffc72a" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M6 42v6l22 10 30-15v-7L28 51z" fill="#e3940c" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M14 42l22-10M20 45l22-10M26 48l22-10" stroke="#fff1a8" stroke-width="2.5"/>
        <path d="M40 31V12l12-4v22" fill="none" stroke="${K}" stroke-width="7" stroke-linecap="round"/>
        <path d="M40 31V12l12-4v22" fill="none" stroke="#ffc72a" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M36 12l20-7" stroke="${K}" stroke-width="7" stroke-linecap="round"/><path d="M36 12l20-7" stroke="#ffe36b" stroke-width="3.5" stroke-linecap="round"/></svg>`,
    star: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4l8 18 20 2-15 13 5 20-18-11-18 11 5-20L4 24l20-2z" fill="#c9c4da" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/></svg>`,
    run: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="38" cy="10" r="7" fill="#f5d29a" stroke="${K}" stroke-width="3"/><path d="M36 18l-8 16 10 8-4 16M30 26l-12 4M36 22l10 10 10-2M28 34l-12 12" fill="none" stroke="${K}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 18l-8 16 10 8-4 16M30 26l-12 4M36 22l10 10 10-2M28 34l-12 12" fill="none" stroke="#1c1c22" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    monster: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 40c-6-16 4-34 22-34s28 18 22 34c-4 12-14 18-22 18S14 52 10 40z" fill="#0c0a12" stroke="#ff1e32" stroke-width="3"/><path d="M14 10l6 8M26 4l2 9M40 4l-2 9M52 10l-6 8" stroke="#0c0a12" stroke-width="5" stroke-linecap="round"/><path d="M18 34q14 12 28 0q-14 18-28 0z" fill="#ffffff"/><path d="M20 26l8 2M44 26l-8 2" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/></svg>`,
};
export function fillIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
        const svg = ICONS[el.dataset.icon];
        if (svg && !el.firstElementChild) el.innerHTML = svg;
    });
}
