// Optional AI coaching: sends the measurements + 4 checkpoint frames to Claude.
// The API key lives only in this browser (localStorage); it is never in the code or repo.

const SYSTEM = `You are a blunt, practical golf coach reviewing a face-on swing video.
You get four annotated checkpoint frames (address, top, impact, finish) and measurements from 2D pose tracking.
Measurements are approximate (one camera, scaled from the golfer's height); treat a 1-2 inch difference as noise.
Write for a busy golfer. No praise padding, no long intros.
Format in Markdown:
**Verdict:** one sentence.
**Fix first:** the single change worth the most, and what it does to ball flight/strike.
**Why it happens:** 1-2 sentences on the likely cause earlier in the swing.
**Drills:** 2 drills, each one line with reps.
**Feel:** one swing thought.
**Film next:** what angle/club to film next time to confirm.
Keep it under 220 words.

You are this golfer's ongoing coach, not a one-off reviewer. When a coaching history is given:
- Judge this swing against the current work-in-progress focus first: is the fix taking hold? Say so plainly with the numbers.
- Don't jump to a new fault every swing. Only change focus if the current one is fixed, or another fault clearly matters more.
- Connect patterns (e.g. a recurring head move and a recurring miss) when the data supports it.
After the review, end with one fenced json block, nothing after it:
\`\`\`json
{"focus": "<one key from the allowed list, or null to keep the current focus>", "note": "<one line for your coaching notebook: what you saw and what you asked for>"}
\`\`\``;

export async function getCoaching({ apiKey, model, A, images, golfer = '', history = '' }) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings first.');
  const metrics = A.checkpoints.map((c) => ({
    checkpoint: c.title,
    items: c.items.map((i) => ({ measure: i.name, you: i.you, tour: i.pro, status: i.status })),
  }));
  const content = [
    ...images.map((d) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } })),
    {
      type: 'text',
      text: `Club: ${A.club}. View: face-on. ${golfer ? `About the golfer: ${golfer}.` : ''}
App's own summary: ${A.summary.headline} — ${A.summary.advice}
Measurements (status good/ok/work vs general tour ranges):
${JSON.stringify(metrics, null, 1)}
${history ? `\nCOACHING HISTORY\n${history}` : '\nNo coaching history yet: this is the first reviewed swing.'}
Allowed focus keys: ${A.checkpoints.flatMap((c) => c.items.map((i) => `${c.key}:${i.name}`)).join(', ')}`,
    },
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Claude API error ${res.status}`);
  const full = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  // Pull the trailing json block (focus + notebook line) out of the visible text
  let meta = null, text = full;
  const m = full.match(/```json\s*([\s\S]*?)```\s*$/);
  if (m) { try { meta = JSON.parse(m[1]); } catch {} text = full.slice(0, m.index).trim(); }
  return { text, meta };
}

/** Tiny Markdown → HTML (bold, italics, lists, paragraphs). Escapes everything first. */
export function md(s) {
  const esc = s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = esc.split('\n');
  let html = '', inList = false;
  for (const ln of lines) {
    const li = ln.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (ln.trim()) html += `<p>${inline(ln.replace(/^#+\s*/, ''))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
