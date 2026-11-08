// The "coach memory": learns recurring faults across swings (learning mode only),
// keeps one work-in-progress focus, and checks each new swing against it.
// Rounds will feed into the same profile once that module exists (see `roundSignals`).
import { PRIORITY_COPY } from './metrics.js';
import { roundTendencies, roundSummaryText } from '../rounds/stats.js';

const PLAN_KEY = 'golf.plan';
const WINDOW = 10;        // tendencies are judged on the last 10 learning swings
const MIN_SWINGS = 3;     // need at least this many before calling something a tendency
const GRADUATE = { last: 5, good: 4 }; // focus is "fixed" when 4 of the last 5 are on target

const PHASE_WEIGHT = { address: 1, top: 1.1, impact: 1.5, finish: 0.7 };
const PHASE_ORDER = ['address', 'top', 'impact', 'finish'];

export const metricKey = (cpKey, name) => `${cpKey}:${name}`;
export function metricLabel(key) {
  const [cp, name] = key.split(':');
  return `${name} at ${cp}`;
}
export function metricCue(key) {
  const c = PRIORITY_COPY[key];
  return c ? c[0].toUpperCase() + c.slice(1) : `Work on ${metricLabel(key).toLowerCase()}`;
}

/** Find a metric in a saved swing record. */
export function itemOf(swing, key) {
  const [cp, name] = key.split(':');
  return swing.checkpoints.find((c) => c.key === cp)?.items.find((i) => i.name === name) || null;
}

export function getPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY) || 'null') || { focus: null, done: [], notes: [] }; }
  catch { return { focus: null, done: [], notes: [] }; }
}
export function savePlan(p) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch {} }

/**
 * swings: saved records (newest first). Returns tendencies sorted by severity.
 * Each: { key, label, cue, n, misses, rate, avg, recentAvg, earlierAvg, trend }
 */
export function tendencies(swings) {
  const learn = swings.filter((s) => s.learning !== false).slice(0, WINDOW);
  if (learn.length < MIN_SWINGS) return { swings: learn.length, list: [] };
  const keys = new Set();
  learn.forEach((s) => s.checkpoints.forEach((c) => c.items.forEach((i) => keys.add(metricKey(c.key, i.name)))));
  const list = [];
  for (const key of keys) {
    const items = learn.map((s) => itemOf(s, key)).filter(Boolean);
    if (items.length < MIN_SWINGS) continue;
    const misses = items.filter((i) => i.status !== 'good').length;
    const hard = items.filter((i) => i.status === 'work').length;
    const rate = misses / items.length;
    if (rate < 0.5) continue; // shows up in at least half your swings
    const vals = items.map((i) => i.value).filter(Number.isFinite);
    const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const half = Math.floor(items.length / 2);
    const rGood = items.slice(0, half).filter((i) => i.status === 'good').length / (half || 1);
    const eGood = items.slice(half).filter((i) => i.status === 'good').length / ((items.length - half) || 1);
    const trend = rGood - eGood > 0.15 ? 'improving' : eGood - rGood > 0.15 ? 'worse' : 'steady';
    const cp = key.split(':')[0];
    list.push({
      key, label: metricLabel(key), cue: metricCue(key), n: items.length, misses, rate, avg, trend,
      latest: items[0]?.you, score: (misses + hard) * (PHASE_WEIGHT[cp] || 1),
    });
  }
  list.sort((a, b) => b.score - a.score || PHASE_ORDER.indexOf(a.key.split(':')[0]) - PHASE_ORDER.indexOf(b.key.split(':')[0]));
  return { swings: learn.length, list };
}

/** Progress on the current focus since it was set. */
export function focusProgress(swings, plan) {
  if (!plan.focus) return null;
  const since = swings.filter((s) => s.learning !== false && s.date >= plan.focus.since);
  const items = since.map((s) => ({ date: s.date, it: itemOf(s, plan.focus.key) })).filter((x) => x.it);
  const last = items.slice(0, GRADUATE.last);
  const good = last.filter((x) => x.it.status === 'good').length;
  return {
    count: items.length, lastN: last.length, good,
    graduated: last.length >= GRADUATE.last && good >= GRADUATE.good,
    values: items.map((x) => ({ date: x.date, value: x.it.value, status: x.it.status, you: x.it.you })).reverse(),
  };
}

/**
 * Called after each learning swing is saved. Sets a focus if there isn't one,
 * graduates the focus when it's fixed, and returns a one-line check-in for this swing.
 */
export function updatePlan(swings, current) {
  const plan = getPlan();
  const t = tendencies(swings);
  const check = current ? checkIn(current, plan) : null; // judged against the focus it was filmed under
  let event = null;
  if (plan.focus) {
    const p = focusProgress(swings, plan);
    if (p?.graduated) {
      plan.done.unshift({ ...plan.focus, finished: Date.now() });
      event = `Fixed: ${plan.focus.label.toLowerCase()}. ${p.good} of your last ${p.lastN} swings were on target.`;
      plan.focus = null;
    }
  }
  if (!plan.focus && t.list.length) {
    const next = t.list.find((x) => !plan.done.some((d) => d.key === x.key && Date.now() - d.finished < 14 * 864e5)) || t.list[0];
    plan.focus = { key: next.key, label: next.label, cue: next.cue, since: current?.date ?? Date.now(), setBy: 'auto' };
    event = (event ? event + ' ' : '') + `New focus: ${next.label.toLowerCase()} (showed up in ${next.misses} of your last ${next.n} swings).`;
  }
  savePlan(plan);
  return { plan, event, check: check || (current ? checkIn(current, plan) : null), tendencies: t };
}

/** How did this one swing do on the current focus? */
export function checkIn(swing, plan = getPlan()) {
  if (!plan.focus) return null;
  const it = itemOf(swing, plan.focus.key);
  if (!it) return null;
  const verdict = it.status === 'good' ? 'On target' : it.status === 'ok' ? 'Close' : 'Not yet';
  return { verdict, status: it.status, text: `${plan.focus.label}: ${it.you}`, key: plan.focus.key };
}

export function setFocus(key) {
  const plan = getPlan();
  plan.focus = key ? { key, label: metricLabel(key), cue: metricCue(key), since: Date.now(), setBy: 'you' } : null;
  savePlan(plan);
  return plan;
}

export function addCoachNote(note) {
  const plan = getPlan();
  plan.notes.unshift({ date: Date.now(), note });
  plan.notes = plan.notes.slice(0, 6);
  savePlan(plan);
}

/** Text block sent to the AI coach so it reviews like a coach who knows you. */
export function coachContext(swings, roundAgg = null) {
  const plan = getPlan();
  const t = tendencies(swings);
  const p = focusProgress(swings, plan);
  const lines = [];
  lines.push(`Learning swings on file: ${t.swings}.`);
  if (t.list.length) lines.push('Recurring tendencies (last 10 learning swings): ' + t.list.slice(0, 5).map((x) => `${x.label} off-target in ${x.misses}/${x.n} (${x.trend}), latest "${x.latest}"`).join('; ') + '.');
  if (plan.focus) {
    lines.push(`Current work-in-progress focus (set ${new Date(plan.focus.since).toDateString()} by ${plan.focus.setBy}): ${plan.focus.label}. Cue: ${plan.focus.cue}.`);
    if (p?.values.length) lines.push(`Focus values since then (oldest→newest): ${p.values.map((v) => `${v.you} [${v.status}]`).join(', ')}.`);
  }
  if (plan.done.length) lines.push(`Previously fixed: ${plan.done.slice(0, 3).map((d) => d.label).join(', ')}.`);
  if (plan.notes.length) lines.push(`Your last coaching notes: ${plan.notes.slice(0, 3).map((n) => `(${new Date(n.date).toDateString()}) ${n.note}`).join(' | ')}`);
  const rs = roundSignals(roundAgg);
  if (rs) lines.push(`On-course data (recent rounds): ${rs}`);
  return lines.join('\n');
}

/** Round stats (miss patterns, tagged causes/strikes) joined into the coach's picture. */
export function roundSignals(A) {
  if (!A) return '';
  const t = roundTendencies(A);
  return roundSummaryText(A) + (t.length ? ` Patterns: ${t.slice(0, 4).map((x) => `${x.text} (${x.detail})`).join('; ')}.` : '');
}
