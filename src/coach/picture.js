// What the mental coach has learned about you: a picture built up conversation by conversation, in the
// style of Vision54's MY54 / NOT54 inventories. What helps you play well, what unravels you, the cues
// and phrases of yours that worked, the one thing agreed for next round, and a short notebook of what
// the coach saw each time. Kept in settings (so it's in your osolo backup) and shown to you in the chat,
// where you can clear it. The coach reads it before every reply and updates it after.
import { getSettings, saveSettings } from '../store.js';

const MAX_LIST = 6, MAX_NOTES = 12;
const clean = (a, n = MAX_LIST) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x || '').trim()).filter(Boolean))].slice(-n);

export const emptyPicture = () => ({ works: [], unravels: [], cues: [], next: null, notes: [], updated: null });

export function getPicture(s = getSettings()) { return { ...emptyPicture(), ...(s.mindPicture || {}) }; }

/** Pull the trailing json block out of a reply. Returns { text, meta } (meta null when there isn't one). */
export function splitLearning(full) {
  const m = String(full || '').match(/```json\s*([\s\S]*?)```\s*$/);
  if (!m) return { text: String(full || '').trim(), meta: null };
  let meta = null; try { meta = JSON.parse(m[1]); } catch { /* the model's json was off: keep the text, learn nothing */ }
  return { text: full.slice(0, m.index).trim(), meta };
}

/** Merge what the coach learned this turn. A field left out stays; lists given replace, trimmed to 6. */
export function learn(meta, s = getSettings()) {
  if (!meta || typeof meta !== 'object') return getPicture(s);
  const p = getPicture(s);
  if ('works' in meta) p.works = clean(meta.works);
  if ('unravels' in meta) p.unravels = clean(meta.unravels);
  if ('cues' in meta) p.cues = clean(meta.cues);
  if ('next' in meta) p.next = meta.next ? String(meta.next).trim() : null;
  if (meta.note) p.notes = [{ at: Date.now(), note: String(meta.note).trim() }, ...p.notes].slice(0, MAX_NOTES);
  p.updated = Date.now();
  s.mindPicture = p; saveSettings(s);
  return p;
}

export function clearPicture(s = getSettings()) { delete s.mindPicture; saveSettings(s); }

const fmtD = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** The picture as the coach reads it. */
export function pictureText(p = getPicture()) {
  const has = p.works.length || p.unravels.length || p.cues.length || p.next || p.notes.length;
  if (!has) return 'WHAT YOU\'VE LEARNED ABOUT THEM\nNothing yet: this is early. Listen for what works for them and what unravels them.';
  return ['WHAT YOU\'VE LEARNED ABOUT THEM (your own notes from earlier conversations; build on these, correct them when today\'s evidence says so)',
    p.works.length ? `What works for them: ${p.works.join(' / ')}.` : '',
    p.unravels.length ? `What unravels them: ${p.unravels.join(' / ')}.` : '',
    p.cues.length ? `Their cues and phrases: ${p.cues.join(' / ')}.` : '',
    p.next ? `Agreed for next round: ${p.next}.` : '',
    p.notes.length ? `Notebook (latest first):\n${p.notes.map((n) => `- ${fmtD(n.at)}: ${n.note}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
