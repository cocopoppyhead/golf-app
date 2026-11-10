// "Add to calendar" for anything with a start time: Google Calendar link or an .ics file
// (Apple / Outlook). Used by practice sessions and scheduled rounds.
import { isNative, nativeSend, blobToBase64, openExternal } from './native.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
export const icsStamp = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };

/** { title, desc, start (ms), end (ms), rrule?, uid, when (text), file? } */
export function calendarSheet({ title, desc = '', start, end, rrule = '', uid, when, file = 'osolo.ics', note = '' }) {
  const g = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(desc)}&dates=${icsStamp(start)}/${icsStamp(end)}${rrule ? `&recur=${encodeURIComponent(rrule)}` : ''}`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//osolo//app//EN', 'BEGIN:VEVENT', `UID:${uid}@osolo.io`, `DTSTAMP:${icsStamp(Date.now())}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`, rrule, `SUMMARY:${title}`, `DESCRIPTION:${desc.replace(/\n/g, '\\n')}`, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Add to calendar</b><button class="link" data-close>Close</button></div>
    <p class="small">${esc(title)}<br><span class="mute">${esc(when || new Date(start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></p>
    <button class="btn primary big" data-g>Google Calendar</button>
    <button class="btn big" data-ics style="margin-top:8px">Apple / Outlook (.ics)</button>
    ${note ? `<p class="mute small" style="margin-top:8px">${esc(note)}</p>` : ''}</div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-g]').onclick = () => openExternal(g);
  sheet.querySelector('[data-ics]').onclick = async () => {
    const blob = new Blob([ics], { type: 'text/calendar' });
    if (isNative()) return nativeSend({ type: 'share.file', name: file, mime: 'text/calendar', b64: await blobToBase64(blob) });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click();
  };
  document.body.appendChild(sheet);
}
