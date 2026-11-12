// Three best shots: after a round, pick the shots you're proudest of and say how they felt and what
// you saw (Karl Morris's post-round exercise). Candidates come from the shots you rated (★), then
// strokes gained. Before the next round on the course, they come back as "your best shots here".
import { holeSG } from './sg.js';

/** Up to `n` candidate shots: { h (hole index), k (shot index), stars, sg, club, dist }. */
export function bestCandidates(round, course, n = 6) {
  const out = [];
  (round.holes || []).forEach((h, i) => {
    if (!h?.shots?.length || h.score == null) return;
    const ch = course.holes[i] || {};
    const sg = h.putts != null ? holeSG(h, ch.par || 4, ch.yds) : null;
    h.shots.forEach((x, k) => out.push({ h: i, k, stars: x.d?.sat || 0, sg: sg?.shots?.[k]?.sg ?? null, club: x.d?.club || null, dist: k > 0 ? x.dist : x.dist ?? ch.yds, res: x.res, plan: x.d?.plan }));
  });
  return out
    .filter((c) => c.stars >= 4 || (c.sg != null && c.sg > 0.15) || c.res === 'HO')
    .sort((a, b) => b.stars - a.stars || (b.res === 'HO') - (a.res === 'HO') || (b.sg ?? -9) - (a.sg ?? -9))
    .slice(0, n);
}

/** The best shots kept from the latest earlier round on this course, for the start of a round. */
export function lastBestHere(rounds, courseId, exceptId) {
  const r = rounds.filter((x) => x.id !== exceptId && x.courseId === courseId && x.best?.length).sort((a, b) => b.date - a.date)[0];
  return r ? r.best.filter((b) => b.note?.trim()).map((b) => ({ ...b, date: r.date })) : [];
}
