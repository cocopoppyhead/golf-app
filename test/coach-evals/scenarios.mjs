// Coach evals: made-up golfers with a known story, a question, and what a good coach must (and must
// not) do. Every round here is synthetic. Run with: ANTHROPIC_API_KEY=… node test/coach-evals/run.mjs
const par = [4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4];
export const course = { id: 'c', name: 'Trump International Dubai', holes: par.map((p) => ({ par: p })) };
const day = (k, hour = 7) => Date.parse(`2026-10-${String(1 + k).padStart(2, '0')}T${String(hour - 4).padStart(2, '0')}:00:00Z`); // Dubai time
/** A round: front and back given as strokes over par per hole (18 numbers), plus extras. */
// each round is nudged so no two cards are identical, keeping the story: within each nine, round k moves
// its dropped shots along by k holes (so "+1 on holes 1-5" becomes "+1 on 2-6", then "3-7", and so on)
const jitter = (k, toPar) => toPar.map((_, i) => { const nine = i < 9 ? 0 : 9, s = (k % 4); return toPar[nine + (((i - nine) - s + 9) % 9)]; });
const round = (k, toPar, extra = {}) => ({ r: { id: `r${k}`, finished: true, date: day(k, extra.hour || 7), courseId: 'c', courseName: course.name, holes: par.map((p, i) => ({ score: p + jitter(k, toPar)[i], putts: 2 })), ...extra }, c: course });
const flat = (front, back) => [...Array(9).fill(0).map((_, i) => (i < front ? 1 : 0)), ...Array(9).fill(0).map((_, i) => (i < back ? 1 : 0))];
const hrHoles = (rc, f, b) => { rc.r.holes.forEach((h, i) => { h.hr = { avg: i < 9 ? f : b }; }); rc.r.hr = { avg: Math.round((f + b) / 2) }; return rc; };

export const SCENARIOS = [
  {
    id: 'heat-fade', title: 'Back nine falls away in the heat, heart rate climbs',
    rounds: [0, 1, 2, 3, 4].map((k) => hrHoles(round(k, flat(1, 6), { hour: 14, cond: { start: { tempC: 36, windMph: 8 } } }), 98, 118)).concat([5, 6, 7].map((k) => round(k, flat(1, 2), { cond: { start: { tempC: 26 } } }))),
    ask: 'Why do I keep falling apart on the back nine?',
    must: [/heat|hot|36|energy|water|hydrat|food|eat|fuel|tired|fatigue/i, /back/i],
    mustNot: [/\b12 over\b/i],
    judge: 'Reads the back-nine fade as mainly physical (heat, energy, heart rate, tee time) using the numbers given, gives one concrete thing for the turn, at most one question.',
  },
  {
    id: 'focus-fade', title: 'Back nine falls away when wound up at the turn, cool days',
    rounds: [0, 1, 2, 3, 4].map((k) => round(k, flat(1, 6), { mood: { start: 5, turn: 8, finish: 8 }, debrief: { tags: ['Lost focus'] }, cond: { start: { tempC: 24 } } })).concat([5, 6, 7].map((k) => round(k, flat(1, 1), { mood: { start: 5, turn: 5, finish: 5 }, cond: { start: { tempC: 25 } } }))),
    ask: 'Why do I keep falling apart on the back nine?',
    must: [/turn|focus|reset|wound|frustrat|calm|breath/i],
    judge: 'Reads it as mental (wound up at the turn, lost focus) rather than heat or fitness, cites the turn mood, gives a reset at the turn.',
  },
  {
    id: 'double-chain', title: 'Doubles come in pairs',
    rounds: [0, 1, 2, 3, 4, 5].map((k) => round(k, par.map((_, i) => (i === 4 + k % 3 ? 2 : i === 5 + k % 3 ? 2 : 0)))),
    ask: 'What is the one thing costing me the most?',
    must: [/after a double|next hole|straight after|reset|let it go|post-shot/i],
    judge: 'Spots that the hole after a double is usually another bogey or worse and gives a reset routine.',
  },
  {
    id: 'process-good', title: 'Good process, bad scores: not the mind this time',
    rounds: [0, 1, 2, 3].map((k) => round(k, flat(5, 5), { process: { routine: 4, commit: 4, accept: 4 }, mood: { start: 5, turn: 5, finish: 5 } })),
    ask: 'Is my head the problem?',
    must: [/not (your|the) (head|mind)|process (was|is) good|strategy|swing|course management/i],
    judge: 'Says plainly the mental side looks sound on this evidence and points elsewhere, without inventing a mental problem.',
  },
  {
    id: 'incomplete', title: 'An unfinished round must not be misread',
    rounds: [round(0, flat(2, 3)), { r: { id: 'x', finished: true, date: day(9), courseId: 'c', courseName: course.name, holes: [{ score: 5 }, { score: 4 }, { score: 3 }, ...Array(15).fill(null)] }, c: course }],
    ask: 'How did I do on 10 October at Trump?',
    must: [/3 holes|three holes|incomplete|didn.t finish|only/i],
    mustNot: [/12 over/i],
    judge: 'Says that round is only 3 holes (12 strokes, 1 under par) and does not call it 12 over.',
  },
  {
    id: 'correction', title: 'Takes a correction in one line',
    rounds: [0, 1, 2].map((k) => round(k, flat(2, 4))),
    history: [{ role: 'user', text: 'How was my last round?' }, { role: 'assistant', text: 'You were 9 over on the back nine on 3 Oct.' }],
    ask: 'No, I was 4 over on the back.',
    must: [/4 over|\+4|right|you're right|got it/i],
    maxWords: 110,
    judge: 'Accepts the correction in one short line without a long apology, uses +4, and carries on usefully.',
  },
  {
    id: 'pre-round', title: 'Before a round: short and calming', mode: 'pre-round',
    rounds: [0, 1, 2, 3, 4].map((k) => round(k, flat(1, 5), { mood: { start: 6, turn: 8, finish: 7 } })),
    ask: 'Get my head right before today',
    maxWords: 100,
    must: [/first tee|1st tee|first hole|opening/i],
    mustNot: [/worst|disaster/i],
    judge: 'Under ~80 words, calm: one intention for today, a first-tee cue, and a plan for the first bad hole.',
  },
  {
    id: 'swing-q', title: 'A swing question gets redirected',
    rounds: [0, 1, 2].map((k) => round(k, flat(2, 3))),
    ask: 'How do I stop my slice?',
    maxWords: 140,
    must: [/swing|practice|analysis|coach/i],
    judge: 'One line acknowledging, points to osolo swing analysis / Practice, then brings it back to the mental side (e.g. committing to a target).',
  },
  {
    id: 'small-sample', title: 'Two rounds is an early read',
    rounds: [0, 1].map((k) => round(k, flat(1, 5))),
    ask: 'Do I fade on the back nine?',
    must: [/early|two rounds|2 rounds|small|too few|not enough|more rounds/i],
    judge: 'Calls it an early read on two rounds and says what would confirm it.',
  },

  {
    id: 'learns', title: 'Learns from what they say, in their words',
    rounds: [0, 1, 2].map((k) => round(k, flat(1, 4), { mood: { start: 5, turn: 7, finish: 7 } })),
    ask: 'Honestly the thing that gets me is when the group ahead is slow. I stand around and start thinking about my swing. When I just walk fast and hum a tune I play fine.',
    learns: ['unravels', 'works', 'cues'],
    must: [/slow|waiting|stand/i],
    judge: 'Uses what they just said (slow play, standing around, thinking about the swing; walking fast and humming works) rather than a generic tip; one thing for the next wait on the course.',
  },
  {
    id: 'uses-picture', title: 'Uses what it already knows about them',
    rounds: [0, 1, 2].map((k) => round(k, flat(1, 3))),
    picture: { works: ['walk fast between shots, hum a tune'], unravels: ['waiting on slow groups, then thinking about my swing'], cues: ['soft hands, see the window'], next: 'say the target out loud on every tee' },
    ask: 'Get my head right before today', mode: 'pre-round',
    maxWords: 100,
    must: [/hum|walk fast|soft hands|window|target out loud/i],
    judge: 'Builds today\'s plan from the known picture (their own cue or agreed next thing appears), under ~80 words, calm.',
  },
  {
    id: 'debrief-order', title: 'A debrief starts with what went well', mode: 'debrief',
    rounds: [0, 1, 2].map((k) => round(k, flat(2, 3), { best: [{ h: 6, club: '7 iron', note: 'flushed it, saw the window' }], debrief: { tags: ['Three-putts'] } })),
    ask: 'Talk me through Trump',
    maxWords: 180,
    judge: 'The first thing it says is something specific that went well (e.g. the 7 iron on 7, "saw the window"), before the strokes lost; ends with one thing and one question.',
  },
];
