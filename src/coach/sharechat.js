// Share the coach chat as a file: the whole conversation, with dates, plus what the coach has learned.
// For the golfer's own records, or to hand to someone (a coach, or Claude to review how the coach did).
// Same route as a swing video: the native share sheet in the app, the browser's share sheet, or a download.
import { isNative, nativeSend, blobToBase64 } from '../native.js';
import { pictureText } from './picture.js';

const day = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The chat as Markdown. msgs: [{ role, text, at, added? }]. */
export function chatMarkdown(msgs, { picture = null, model = '' } = {}) {
  const out = [`# osolo coach chat`, '', `Exported ${day(Date.now())}${model ? `. Coach: ${model}` : ''}.`, ''];
  for (const m of msgs) {
    out.push(`## ${m.role === 'user' ? 'Me' : 'Coach'}${m.at ? ` (${day(m.at)})` : ''}`, '', String(m.text || '').trim(), '');
    if (m.added) out.push(`_Added to Range work: ${m.added}_`, '');
  }
  const p = picture ? pictureText(picture) : '';
  if (p) out.push('---', '', '## What the coach has learned', '', p, '');
  return out.join('\n');
}

export async function shareChat(msgs, opts = {}) {
  const text = chatMarkdown(msgs, opts);
  const name = `osolo-coach-chat-${new Date().toISOString().slice(0, 10)}.md`;
  const blob = new Blob([text], { type: 'text/markdown' });
  if (isNative()) return nativeSend({ type: 'share.file', name, mime: 'text/markdown', b64: await blobToBase64(blob) });
  const file = new File([blob], name, { type: 'text/markdown' });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: 'Coach chat' }).catch(() => {});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
