// The app shell: the settings object the screens share, tabs, screens inside the Practice tab, and toasts.
// Screens register what to do when their tab opens or closes (onTab / onLeaveTab), so the shell knows
// nothing about any one screen.
import { getSettings } from '../store.js';

export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The live settings (reload with app.settings = getSettings() after an import or a sync). */
export const app = { settings: getSettings() };

export function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

/** Show one screen of the Practice tab. */
export function screen(id) {
  document.querySelectorAll('#tab-coach .screen').forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
}

const TITLES = { coach: 'Practice', history: 'Progress', rounds: 'Play', bag: 'Bag', settings: 'Settings' };
const enter = new Map(), leave = [];
/** fn({ fromNav }) runs when the tab opens. */
export const onTab = (name, fn) => { if (!enter.has(name)) enter.set(name, []); enter.get(name).push(fn); };
/** fn(nextTab) runs on every tab change. */
export const onLeaveTab = (fn) => leave.push(fn);

export function showTab(name, fromNav = false) {
  leave.forEach((fn) => fn(name));
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $('#tabTitle').textContent = TITLES[name];
  (enter.get(name) || []).forEach((fn) => fn({ fromNav }));
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab, true)));
