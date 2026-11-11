// The on-course half of a club's page: what the rounds say about this club, strengths and
// weaknesses against the golfer's level and scratch, and practice on its area.
import { listRounds, getCourse, listSessions, getSettings } from './store.js';
import { drillResults, drillsLoaded, loadDrills, areaTrend } from './drills.js';
import { clubOnCourse, clubVerdicts, levelRows, clubArea } from './clubstats.js';
import { levelLabel, SOURCES } from './benchmarks.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The golfer's handicap index: the one they keep, else null (the benchmark then assumes 15). */
function myHandicap() {
  const s = getSettings();
  const h = s.handicap ?? s.handicapIndex ?? null;
  return Number.isFinite(+h) ? +h : null;
}

export async function practiceOnArea(area) {
  const lib = drillsLoaded() || (await loadDrills().catch(() => null));
  const [results, sessions] = await Promise.all([drillResults().catch(() => []), listSessions().catch(() => [])]);
  const ids = new Set((lib?.drills || []).filter((d) => d.area === area).map((d) => d.id));
  const cut = Date.now() - 30 * 864e5;
  const sessions30 = sessions.filter((s) => (s.status === 'done' || (!s.status && s.date)) && (s.finishedAt || s.date || 0) >= cut && (s.items || []).some((it) => ids.has(it.drillId))).length;
  const trend = lib ? areaTrend(area, lib, results) : null;
  return { area, sessions30, trend, results: results.filter((r) => ids.has(r.drillId)).length };
}

export async function clubCourseHtml(club) {
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished && r.learning !== false && !r.quick);
  const withCourse = [];
  for (const r of rounds) { const c = await getCourse(r.courseId).catch(() => null); if (c) withCourse.push({ r, c }); }
  const S = clubOnCourse(withCourse, club);
  const hcp = myHandicap();
  const practice = await practiceOnArea(clubArea(club)).catch(() => null);
  if (!S.n && !practice?.results) return '';
  const V = clubVerdicts(S, { hcp, practice });
  const rows = levelRows(S, hcp);
  const lvl = levelLabel(hcp);
  const mark = (b) => (b > 0 ? '<span class="goodc">▲</span>' : b < 0 ? '<span style="color:var(--work)">▼</span>' : '<span class="mute">●</span>');
  const record = S.n ? `<div class="card"><h2>On the course <span class="mute small">${S.n} shots · ${S.rounds} round${S.rounds === 1 ? '' : 's'}${S.last ? ` · last ${fmtD(S.last)}` : ''}</span></h2>
    ${rows.length ? `<table class="ltable lvl"><tr><th>Number</th><th>You</th><th>${esc(lvl)}</th><th>Scratch</th></tr>
      ${rows.map((x) => `<tr><td>${esc(x.label)}<br><span class="mute small">${x.n} shots</span></td><td><b>${x.you ?? '–'}</b> ${mark(x.better)}</td><td>${x.level}</td><td>${x.scratch}</td></tr>`).join('')}</table>
      <p class="mute small" style="margin:6px 0 0">${hcp == null ? 'Set your handicap in your profile for a like-for-like level; 15 is assumed. ' : ''}Level and scratch figures: ${SOURCES.join('; ')}.</p>` : '<p class="mute small">Name the club in a shot\'s Details and its fairways, greens and misses build up here.</p>'}
    ${S.sgPerShot != null || S.planned != null ? `<p class="small" style="margin:8px 0 0">${S.sgPerShot != null ? `SG per shot <b>${S.sgPerShot >= 0 ? '+' : ''}${S.sgPerShot.toFixed(2)}</b> (${S.sg.n})` : ''}${S.planned != null ? ` · as planned <b>${Math.round(S.planned * 100)}%</b>` : ''}${S.satisfaction != null ? ` · satisfaction <b>${S.satisfaction.toFixed(1)}★</b>` : ''}</p>` : ''}
  </div>` : '';
  const verdicts = V.length ? `<div class="card"><h2>Strengths and weaknesses</h2>
    ${V.map((v) => `<div class="verdict ${v.kind}"><i>${v.kind === 'strength' ? '+' : v.kind === 'weakness' ? '−' : '·'}</i><span>${esc(v.text)}</span></div>`).join('')}
    ${practice ? `<p class="mute small" style="margin:8px 0 0">Practice on ${esc(practice.area)}: ${practice.sessions30} session${practice.sessions30 === 1 ? '' : 's'} in 30 days, ${practice.results} drill results logged.</p>` : ''}</div>`
    : (S.n ? `<div class="card"><h2>Strengths and weaknesses</h2><p class="mute small">Appears after about 8 tee shots or approaches logged with this club in Details.</p></div>` : '');
  return record + verdicts;
}
