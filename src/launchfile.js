// Launch-monitor exports as files: the CSV/TSV a Garmin R10 (Garmin Golf app), TrackMan, FlightScope
// Mevo, Rapsodo MLM or a sim exports. Headers vary by vendor, so columns are matched by meaning
// (synonyms + units in the header) into the same { columns, rows } shape the photo reader returns,
// grouped by club when the file has one. No DOM; the Bag card drives the review from here.

const SYN = [
  ['clubSpeed', /^(club( ?head)? ?speed|chs)$/],
  ['ballSpeed', /^(ball ?speed|bs|ball)$/],
  ['smash', /^(smash( ?factor)?|sf|efficiency)$/],
  ['launch', /^(launch( ?angle)?|launch ?v(ertical)?|la|vla|vert(ical)? launch)$/],
  ['azimuth', /^(launch ?dir(ection)?|launch ?h(orizontal)?|hla|side angle|direction)$/],
  ['backSpin', /^(back ?spin|spin ?rate|spin|total ?spin|rpm)$/],
  ['sideSpin', /^(side ?spin)$/],
  ['spinAxis', /^(spin ?axis|axis|tilt)$/],
  ['carry', /^(carry( ?distance| ?dist)?|carry ?\(?(yd|yds|yards|m|metres|meters)\)?)$/],
  ['total', /^(total( ?distance| ?dist)?|total ?\(?(yd|yds|yards|m)\)?)$/],
  ['apex', /^(apex( ?height)?|height|max ?height|peak ?height)$/],
  ['descent', /^(descent( ?angle)?|land(ing)? ?angle|angle of descent|aod)$/],
  ['side', /^(side|lateral|offline|carry ?deviation ?dist(ance)?|side ?carry|carry ?side|deviation)$/],
  ['toTarget', /^(to ?target|distance to target|from ?pin|to ?pin)$/],
  ['face', /^(face( ?angle)?|club ?face|face to target)$/],
  ['path', /^(club ?path|path|swing ?path)$/],
  ['attack', /^(attack( ?angle)?|angle of attack|aoa)$/],
  ['club', /^(club ?name|club ?type|club ?used|club ?selection|golf ?club)$/],
  ['shot', /^(shot( ?#| ?no\.?| ?number| ?id)?|#|no\.?|index)$/],
  ['date', /^(date|time|date ?time|timestamp|created)$/],
];
const UNIT_RE = /[[(]\s*([a-z/°%]+)\s*[\])]/i;

/** Split delimited text (comma, semicolon or tab; quotes honoured) into rows of strings. */
export function parseDelimited(text) {
  const t = text.replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t'].map((d) => [d, (first.match(new RegExp(d === '\t' ? '\t' : `\\${d}`, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  rows.delim = delim;
  return rows;
}

/** Map a header row to canonical keys: [{ i, key, label, unit }] (unknown columns dropped). */
export function mapHeaders(headers) {
  const out = [];
  headers.forEach((h, i) => {
    const raw = String(h || '').trim(); if (!raw) return;
    const unit = (raw.match(UNIT_RE)?.[1] || '').toLowerCase().replace('°', 'deg');
    const name = raw.replace(UNIT_RE, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const speedUnit = ['mph', 'kmh', 'km/h', 'ms', 'm/s'].includes(unit);
    // a bare "Club" is the club name, unless it carries a speed unit (FlightScope: "Club (km/h)")
    const hit = name === 'club' ? [speedUnit ? 'clubSpeed' : 'club'] : SYN.find(([, re]) => re.test(name));
    if (!hit) return;
    const key = hit[0];
    if (out.some((c) => c.key === key)) return; // first match wins (TrackMan has both Side and Side Total; Garmin has Club Name and Club Type)
    out.push({ i, key, label: raw, unit: unit === 'kmh' || unit === 'km/h' ? 'kmh' : unit === 'm/s' || unit === 'ms' ? 'ms' : unit === 'm' || unit === 'metres' || unit === 'meters' ? 'm' : unit === 'ft' ? 'ft' : '' });
  });
  return out;
}

const CLUB_NORMAL = [[/^dr(iver)?$/i, 'Driver'], [/^(\d)\s*w(ood)?$/i, (m) => `${m[1]} wood`], [/^(\d)\s*(h|hy|hybrid|rescue)$/i, (m) => `${m[1]} hybrid`], [/^(\d)\s*(i|iron)$/i, (m) => `${m[1]} iron`], [/^(p|pitching)\s*w(edge)?$/i, 'PW'], [/^(g|gap|a|approach)\s*w(edge)?$/i, 'GW'], [/^(s|sand)\s*w(edge)?$/i, 'SW'], [/^(l|lob)\s*w(edge)?$/i, 'LW'], [/^(\d\d)\s*(°|deg)?$/i, (m) => `${m[1]}°`]];
/** 'Dr' → 'Driver', '7i' → '7 iron', '56' → '56°'; anything else trimmed as is. */
export function normaliseClub(s) {
  const t = String(s || '').trim(); if (!t) return '';
  for (const [re, to] of CLUB_NORMAL) { const m = t.match(re); if (m) return typeof to === 'function' ? to(m) : to; }
  return t;
}

/**
 * A whole file → [{ club, date, table: { columns, rows } }], one per club found (club '' when the file
 * has no club column). `table` is in the photo reader's shape, ready for normaliseTable().
 */
export function parseLaunchFile(text, { filename = '' } = {}) {
  const rows = parseDelimited(text);
  if (rows.length < 2) return [];
  // the header is the first row with 3+ recognised columns (TrackMan puts a title block above it)
  let hi = -1, cols = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) { const m = mapHeaders(rows[i]); if (m.filter((c) => c.key !== 'date' && c.key !== 'shot').length >= 3) { hi = i; cols = m; break; } }
  if (hi < 0) return [];
  // in a semicolon/tab file a comma inside a number is a decimal comma (TrackMan from a European locale)
  const dec = (x) => (rows.delim !== ',' && /^\s*[LR]?\s*-?\d+,\d+\s*$/.test(x) ? x.replace(',', '.') : x);
  const data = rows.slice(hi + 1).filter((r) => r.some((x) => /\d/.test(x))).map((r) => r.map(dec));
  // feet to yards for apex; m/s and km/h and metres handled by normaliseTable via the unit field
  const clubCol = cols.find((c) => c.key === 'club'), dateCol = cols.find((c) => c.key === 'date');
  const groups = new Map();
  for (const r of data) {
    const isAvg = r.some((x) => /^(avg|average|mean|std|sd|total|max|min)\b/i.test(String(x).trim()));
    if (isAvg) continue;
    const club = clubCol ? normaliseClub(r[clubCol.i]) : '';
    if (!groups.has(club)) groups.set(club, []);
    groups.get(club).push(r);
  }
  const source = /trackman/i.test(filename) ? 'TrackMan' : /garmin|r10/i.test(filename) ? 'Garmin R10' : /mevo|flightscope/i.test(filename) ? 'FlightScope' : /rapsodo|mlm/i.test(filename) ? 'Rapsodo' : '';
  return [...groups.entries()].map(([club, rs]) => {
    const columns = cols.filter((c) => c.key !== 'club' && c.key !== 'date').map((c) => ({ key: c.key, label: c.label, unit: c.unit === 'ft' ? 'ft' : c.unit }));
    const rowsOut = rs.map((r) => columns.map((c) => { const v = r[cols.find((x) => x.key === c.key).i]; return c.unit === 'ft' && v !== '' && Number.isFinite(+v) ? String(+v / 3) : v; }));
    const when = dateCol ? Date.parse(rs[0][dateCol.i]) : NaN;
    return { club, date: Number.isFinite(when) ? when : null, source, table: { columns: columns.map((c) => ({ ...c, unit: c.unit === 'ft' ? 'yd' : c.unit })), rows: rowsOut, club: club || null, notes: '' } };
  });
}
