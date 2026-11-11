// Line drawings for each part of the game, in the manner of a yardage book: ink lines, a wash of turf,
// a yellow dashed ball flight, a red flag. 96 × 64, coloured by CSS (.art classes in styles.css).
const svg = (body, label) => `<svg viewBox="0 0 96 64" class="art" role="img" aria-label="${label}">${body}</svg>`;
const flag = (x, y, h = 24) => `<path d="M${x} ${y} V${y - h}" class="a-line"/><path d="M${x} ${y - h} l13 4 -13 4 Z" class="a-flag"/>`;

export const ART = {
  scoring: svg(`<rect x="8" y="10" width="80" height="46" rx="4" class="a-fill"/><rect x="8" y="10" width="80" height="46" rx="4" class="a-line"/>
    <path d="M8 25 H88 M8 40 H88 M28 10 V56 M48 10 V56 M68 10 V56" class="a-thin"/>
    <text x="18" y="35.5" class="a-num">4</text><circle cx="38" cy="32.5" r="6" class="a-line"/><text x="38" y="35.5" class="a-num">3</text>
    <rect x="52" y="27" width="12" height="11" class="a-line"/><text x="58" y="35.5" class="a-num">5</text><text x="78" y="35.5" class="a-num">4</text>`, 'A scorecard'),
  driving: svg(`<path d="M30 60 C 44 40, 70 34, 92 30 L92 44 C 72 46, 52 52, 44 62 Z" class="a-fill"/>
    <path d="M30 60 C 44 40, 70 34, 92 30 M44 62 C 52 52, 72 46, 92 44" class="a-thin"/>
    <path d="M8 54 h12" class="a-line"/><path d="M14 54 v-6" class="a-line"/><circle cx="14" cy="45" r="3" class="a-ball"/>
    <path d="M17 43 C 34 6, 66 4, 80 36" class="a-dash"/>`, 'A drive down the fairway'),
  approach: svg(`<ellipse cx="66" cy="46" rx="24" ry="11" class="a-fill"/><ellipse cx="66" cy="46" rx="24" ry="11" class="a-line"/>
    <circle cx="10" cy="54" r="3" class="a-ball"/><path d="M13 52 C 26 10, 54 8, 62 44" class="a-dash"/>${flag(72, 45, 26)}<ellipse cx="72" cy="45" rx="3" ry="1.6" class="a-hole"/>`, 'An approach to the green'),
  short: svg(`<ellipse cx="62" cy="40" rx="30" ry="14" class="a-fill"/><path d="M32 40 C 34 28, 88 26, 92 40" class="a-line"/>
    <path d="M6 56 C 10 44, 34 44, 38 56 Z" class="a-sand"/><path d="M6 56 C 10 44, 34 44, 38 56" class="a-line"/>
    <circle cx="22" cy="50" r="3" class="a-ball"/><path d="M24 48 C 30 30, 42 30, 48 40 C 52 36, 56 36, 60 40" class="a-dash"/>${flag(72, 40, 24)}<ellipse cx="72" cy="40" rx="3" ry="1.6" class="a-hole"/>`, 'A chip out of a bunker'),
  putting: svg(`<ellipse cx="48" cy="38" rx="42" ry="20" class="a-fill"/><ellipse cx="48" cy="38" rx="42" ry="20" class="a-line"/>
    <path d="M14 46 C 30 30, 52 44, 70 34" class="a-dash"/><circle cx="14" cy="46" r="3.2" class="a-ball"/><ellipse cx="72" cy="33" rx="4.5" ry="2.4" class="a-hole"/>${flag(72, 33, 25)}`, 'A putt rolling to the hole'),
  mind: svg(`<circle cx="48" cy="34" r="26" class="a-fill"/><circle cx="48" cy="34" r="26" class="a-thin"/><circle cx="48" cy="34" r="17" class="a-thin"/><circle cx="48" cy="34" r="8" class="a-line"/>
    <path d="M10 34 H86" class="a-dash"/>${flag(48, 34, 20)}`, 'A target and an eye line'),
};

/** The contour motif (a green's slope map) as a CSS mask, for hero bands. */
export const CONTOUR = (() => {
  const rings = [];
  for (let i = 0; i < 11; i++) {
    const r = 18 + i * 16, pts = [];
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const rr = r * (1 + 0.07 * Math.sin(2 * a + 1.3) + 0.05 * Math.sin(3 * a + 4.1) + 0.04 * Math.sin(5 * a + 2.2) + 0.03 * Math.sin(4 * a + 0.4));
      pts.push(`${(300 + rr * Math.cos(a) * 1.35).toFixed(1)},${(120 + rr * Math.sin(a)).toFixed(1)}`);
    }
    rings.push(`<path d="M${pts.join('L')}Z"/>`);
  }
  return `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 260" fill="none" stroke="#000" stroke-width="1">${rings.join('')}</svg>`)}')`;
})();
