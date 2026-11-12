// Optional AI coaching: sends the measurements + 4 checkpoint frames to Claude, ChatGPT or Gemini.
// The API key lives only in this browser (localStorage); it is never in the code or repo.

const SYSTEM = `You are a blunt, practical golf coach reviewing a face-on swing video.
You get four annotated checkpoint frames (address, top, impact, finish) and measurements from 2D pose tracking.
Measurements are approximate (one camera, scaled from the golfer's height); treat a 1-2 inch difference as noise.
Write for a busy golfer. No praise padding, no long intros.
Format in Markdown:
**Verdict:** one sentence.
**Fix first:** the single change worth the most, and what it does to ball flight/strike.
**Why it happens:** 1-2 sentences on the likely cause earlier in the swing.
**Drills:** 2 drills, each one line with reps. Prefer drills from the library list you are given (name them exactly); invent one only if nothing there fits.
**Feel:** one swing thought.
**Film next:** what angle/club to film next time to confirm.
Keep it under 220 words.

You are this golfer's ongoing coach, not a one-off reviewer. When a coaching history is given:
- Judge this swing against the current work-in-progress focus first: is the fix taking hold? Say so plainly with the numbers.
- Don't jump to a new fault every swing. Only change focus if the current one is fixed, or another fault clearly matters more.
- Connect patterns (e.g. a recurring head move and a recurring miss) when the data supports it.
After the review, end with one fenced json block, nothing after it:
\`\`\`json
{"focus": "<one key from the allowed list, or null to keep the current focus>", "note": "<one line for your coaching notebook: what you saw and what you asked for>", "drills": ["<library drill id>", "<library drill id>"]}
\`\`\``;

// ---- providers: Claude, ChatGPT (OpenAI) and Gemini. Keys live only on this phone. ----
export const PROVIDERS = {
  claude: { label: 'Claude (Anthropic)', short: 'Claude', keyField: 'apiKey', modelField: 'model', def: 'claude-sonnet-5-5', ph: 'sk-ant-…', where: 'console.anthropic.com' },
  openai: { label: 'ChatGPT (OpenAI)', short: 'ChatGPT', keyField: 'openaiKey', modelField: 'openaiModel', def: '', ph: 'sk-…', where: 'platform.openai.com/api-keys' },
  gemini: { label: 'Gemini (Google)', short: 'Gemini', keyField: 'geminiKey', modelField: 'geminiModel', def: '', ph: 'AIza…', where: 'aistudio.google.com/apikey' },
};
/** The AI settings in use: { provider, apiKey, model }. */
export function aiFrom(s) {
  const provider = PROVIDERS[s.aiProvider] ? s.aiProvider : 'claude';
  const p = PROVIDERS[provider];
  return { provider, apiKey: s[p.keyField] || '', model: s[p.modelField] || p.def };
}
export const aiReady = (s) => !!aiFrom(s).apiKey;
export const aiName = (s) => PROVIDERS[aiFrom(s).provider].short;

/** Models this key can use, best first. */
export async function listModels(provider, apiKey) {
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error?.message || `OpenAI error ${r.status}`);
    const skip = /(audio|realtime|search|transcribe|tts|image|instruct|embedding|moderation|dall|whisper|codex|oss|preview|\d{4}-\d{2}-\d{2})/i;
    return rank(d.data.map((m) => m.id).filter((id) => /^(gpt-|chatgpt|o\d)/i.test(id) && !skip.test(id)), /(mini|nano|luna)/i);
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error?.message || `Gemini error ${r.status}`);
    const skip = /(embedding|tts|image|live|audio|aqa|vision|learnlm|gemma|robotics|computer|exp|preview)/i;
    return rank((d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).filter((id) => /gemini/i.test(id) && !skip.test(id)), /(lite|flash-8b)/i);
  }
  return [PROVIDERS.claude.def];
}
// newest version first; "small" models last
function rank(ids, small) {
  const ver = (id) => (id.match(/\d+(\.\d+)?/) || ['0'])[0] * 1;
  return [...new Set(ids)].sort((a, b) => (small.test(a) - small.test(b)) || ver(b) - ver(a) || a.length - b.length);
}

async function callLLM({ provider = 'claude', apiKey, model, system, content, maxTokens = 1200 }) {
  const name = PROVIDERS[provider]?.short || 'AI';
  if (!apiKey) throw new Error(`Add your ${name} API key in Settings first.`);
  if (!model) model = (await listModels(provider, apiKey))[0];
  const images = content.filter((c) => c.type === 'image').map((c) => c.source.data);
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n\n');

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_completion_tokens: maxTokens * 3,
        messages: [{ role: 'system', content: system }, { role: 'user', content: [...images.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } })), { type: 'text', text }] }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `ChatGPT API error ${res.status}`);
    return data.choices?.[0]?.message?.content || '';
  }
  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [...images.map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } })), { text }] }],
        generationConfig: { maxOutputTokens: maxTokens * 4 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
    return (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('\n');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Claude API error ${res.status}`);
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/** Server-sent events from a fetch response: calls each(json) for every `data:` line. */
async function readSSE(res, each) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { each(JSON.parse(data)); } catch { /* a partial or keep-alive line */ }
    }
  }
}

/**
 * A conversation: messages [{ role: 'user' | 'assistant', text }], text only. Same three providers.
 * Streams: onText(soFar) is called as the reply arrives, so the first words show in a second or two.
 * Returns { text, cut } — cut is true when the reply hit the length limit.
 */
export async function chatLLM({ provider = 'claude', apiKey, model, system, messages, maxTokens = 2000, onText = () => {} }) {
  const name = PROVIDERS[provider]?.short || 'AI';
  if (!apiKey) throw new Error(`Add your ${name} API key in Settings first.`);
  if (!model) model = (await listModels(provider, apiKey))[0];
  let text = '', cut = false;
  const add = (t) => { if (t) { text += t; onText(text); } };
  const fail = async (res, who) => { const d = await res.json().catch(() => ({})); throw new Error(d?.error?.message || `${who} error ${res.status}`); };
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: true, max_completion_tokens: maxTokens * 3, messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))] }) });
    if (!res.ok) await fail(res, 'ChatGPT API');
    await readSSE(res, (j) => { const c = j.choices?.[0]; add(c?.delta?.content); if (c?.finish_reason === 'length') cut = true; });
    return { text, cut };
  }
  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), generationConfig: { maxOutputTokens: maxTokens * 4 } }) });
    if (!res.ok) await fail(res, 'Gemini API');
    await readSSE(res, (j) => { const c = j.candidates?.[0]; (c?.content?.parts || []).filter((p) => p.text && !p.thought).forEach((p) => add(p.text)); if (c?.finishReason === 'MAX_TOKENS') cut = true; });
    return { text, cut };
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system, messages: messages.map((m) => ({ role: m.role, content: m.text })) }) });
  if (!res.ok) await fail(res, 'Claude API');
  let err = null;
  await readSSE(res, (j) => {
    if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') add(j.delta.text);
    if (j.type === 'message_delta' && j.delta?.stop_reason === 'max_tokens') cut = true;
    if (j.type === 'error') err = j.error?.message || 'Claude stopped with an error';
  });
  if (err && !text) throw new Error(err);
  return { text, cut };
}

const img = (d) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } });

/** Read a scorecard photo into JSON. kind: 'course' (par/SI/yards) or 'scores' (one player's row). */
export async function readCard({ provider, apiKey, model, images, kind, player = '', holes = 18 }) {
  const ask = kind === 'course'
    ? `This is a golf scorecard. Extract the course layout. Return ONLY JSON:
{"name": "<course name if printed, else null>", "tees": [{"name": "<tee colour/name>", "yards": [<${holes} numbers or null>]}], "par": [<${holes} integers>], "si": [<${holes} integers or null>]}
Use the men's stroke index row if there are several. If a value is unreadable use null.`
    : `This is a filled-in golf scorecard. Read the hole-by-hole scores for ${player ? `the player "${player}" (match the name or initials)` : 'the player whose row is filled in most completely (if several, the first player row)'}.
The player may also mark putts as a small number next to the score (e.g. "5²" or "5/2") and a fairway hit with a dot or tick.
Return ONLY JSON: {"player": "<name/initials on the row>", "scores": [<${holes} integers or null>], "putts": [<${holes} integers or null>], "fairway": [<${holes} true/false/null>], "confidence": "<high|medium|low>", "notes": "<anything unclear>"}`;
  const text = await callLLM({ provider, apiKey, model, system: 'You read golf scorecards precisely. Output only valid JSON, no prose.', content: [...images.map(img), { type: 'text', text: ask }], maxTokens: 1500 });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Could not read that card. Try a flatter, brighter photo.');
  return JSON.parse(m[0]);
}

/**
 * A photo of a launch monitor / simulator table (TrackMan, Toptracer, GC, a Korean sim bay…).
 * Returns { columns: [{ key, label, unit }], rows: [[cell…]], notes } with one row per shot and
 * no average row. key is one of the canonical names below or 'other'.
 */
export async function readLaunchTable({ provider, apiKey, model, images }) {
  const ask = `This is a photo of a golf launch monitor or simulator results table. Extract it.
Return ONLY JSON: {"columns": [{"key": "<canonical>", "label": "<header as printed>", "unit": "<yd|m|mph|kmh|ms|deg|rpm|null>"}], "rows": [[<one value per column, numbers as numbers; a left/right value as a signed number: left negative, right positive; unreadable = null>]], "club": "<club name if shown anywhere, else null>", "notes": "<anything unclear>"}
Canonical keys (use exactly these when the column means it, else "other"): shot (row number), total (total distance), carry, launch (launch angle), ballSpeed, clubSpeed (head/club speed), smash (smash factor), backSpin, sideSpin, spinAxis, spin (total spin), apex (peak height), descent (land angle), toTarget (distance from target), side (lateral offline), azimuth (launch direction), face (face angle), path (club path), attack (attack angle), club (club name), other.
Rules: one row per shot in table order; skip any average/total/summary row; keep the printed units; do not invent values.`;
  const text = await callLLM({ provider, apiKey, model, system: 'You read golf launch-monitor tables precisely. Output only valid JSON, no prose.', content: [...images.map(img), { type: 'text', text: ask }], maxTokens: 3000 });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Could not read that table. Try a straighter, brighter photo.');
  return JSON.parse(m[0]);
}

const ROUND_SYSTEM = `You are the golfer's ongoing coach. You see their round stats, their tagged mistakes (their own codes), their recent rounds and their swing profile from video analysis.
Be blunt and short. No praise padding. Markdown:
**Verdict:** one sentence on the round.
**Where the shots went:** the 2 biggest leaks with numbers.
**Why:** link on-course patterns to swing tendencies when the data supports it (e.g. tee misses right + hips sliding at the top). Say "no clear link" if there isn't one.
**Next round:** 2 course-management changes they can make without practice.
**Practice (only if worth it):** one 20-minute session.
Under 230 words. Then end with one fenced json block: \`\`\`json {"note": "<one line for your coaching notebook>"} \`\`\``;

export async function reviewRound({ provider, apiKey, model, roundText, recentText, history, golfer = '' }) {
  const full = await callLLM({ provider, apiKey, model, system: ROUND_SYSTEM, content: [{ type: 'text', text: `${golfer ? `About the golfer: ${golfer}\n` : ''}THIS ROUND\n${roundText}\n\nRECENT ROUNDS\n${recentText || 'none yet'}\n\nCOACHING HISTORY (swings + notebook)\n${history || 'none yet'}` }] });
  let meta = null, text = full;
  const m = full.match(/```json\s*([\s\S]*?)```\s*$/);
  if (m) { try { meta = JSON.parse(m[1]); } catch {} text = full.slice(0, m.index).trim(); }
  return { text, meta };
}

export async function getCoaching({ provider, apiKey, model, A, images, golfer = '', history = '' }) {
  if (!apiKey) throw new Error('Add an AI key (Claude, ChatGPT or Gemini) in Settings first.');
  const metrics = A.checkpoints.map((c) => ({
    checkpoint: c.title,
    items: c.items.map((i) => ({ measure: i.name, you: i.you, tour: i.pro, status: i.status })),
  }));
  const content = [
    ...images.map((d) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } })),
    {
      type: 'text',
      text: `Club: ${A.club}. View: ${A.view === 'dtl' ? 'down-the-line (from behind)' : 'face-on'}. ${golfer ? `About the golfer: ${golfer}.` : ''}
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
