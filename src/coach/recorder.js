// In-app camera for Range mode: phone on a tripod, record several swings in one go.
export async function openRecorder(root, { onDone, onCancel }) {
  let stream, rec, chunks = [], t0 = 0, timer = null;
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  root.innerHTML = `<div class="recorder">
    <video id="recPrev" playsinline muted autoplay></video>
    <div class="rec-top"><button class="link" data-x>✕ Close</button><span id="recTime" class="rec-time"></span></div>
    <div class="rec-hint" id="recHint">Phone on a tripod or your bag. Whole body in frame. Hit 3–4 balls, then stop.</div>
    <div class="rec-bot"><button class="recbtn" id="recBtn" aria-label="Record"><span></span></button></div>
  </div>`;
  const v = root.querySelector('#recPrev');
  const close = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  root.querySelector('[data-x]').onclick = () => { try { rec?.stop(); } catch {} close(); onCancel(); };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } });
  } catch (e) {
    root.querySelector('#recHint').textContent = 'Camera not available. Allow camera access, or record with your camera app and use Upload.';
    return;
  }
  v.srcObject = stream;
  const btn = root.querySelector('#recBtn');
  btn.onclick = () => {
    if (!rec) {
      chunks = [];
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => { close(); onDone(new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' })); };
      rec.start(1000);
      t0 = Date.now(); btn.classList.add('on');
      root.querySelector('#recHint').textContent = 'Recording. Swing away — tap stop when you\'re done.';
      timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); root.querySelector('#recTime').textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= 300) rec.stop(); }, 250);
    } else rec.stop();
  };
}
