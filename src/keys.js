// "My swing keys": the golfer's own notes, in a light format.
//   # Section title
//   - a key / swing thought
// Shown on the Swing page and sent to the AI coach so it coaches in your language.
import { getSettings, saveSettings } from './store.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const getKeysText = () => getSettings().keys || '';
export function setKeysText(t) { const s = getSettings(); s.keys = t; saveSettings(s); }

export function parseKeys(text) {
  const out = []; let cur = null;
  for (const raw of (text || '').split('\n')) {
    const ln = raw.trim(); if (!ln) continue;
    if (ln.startsWith('#')) { cur = { title: ln.replace(/^#+\s*/, ''), items: [] }; out.push(cur); }
    else { if (!cur) { cur = { title: 'Keys', items: [] }; out.push(cur); } cur.items.push(ln.replace(/^[-*•]\s*/, '')); }
  }
  return out;
}

export function keysHtml(text, { only = null } = {}) {
  const secs = parseKeys(text).filter((s) => !only || only.test(s.title));
  return secs.map((s) => `<h4>${esc(s.title)}</h4><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');
}
