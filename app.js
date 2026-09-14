// Kamera HD v3 - full-res ImageCapture + fullscreen
const $ = id => document.getElementById(id);
const video = $('video');
const capCanvas = $('captureCanvas');
const workCanvas = $('workCanvas');

const S = { stab: true, blur: true, stamp: true, mirror: false, sharpen: true, facing: 'environment', torch: false, res: '1920x1080', ratio: 'full', mode: 'photo', filter: 'none' };
let stream = null, track = null, caps = {}, settings = {};
let imgCap = null, photoMax = null;
let gallery = [];
let gps = { lat: null, lon: null, acc: null, street: '', full: '' };
let heading = null;
let stability = 100, motionE = 0;
let recording = null, recStart = 0, recTick = null;
let zoomV = 1;

function toast(m, ms = 2200) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(t._x); t._x = setTimeout(() => t.classList.add('hidden'), ms); }

// ---------- IZIN OTOMATIS ----------
async function requestAll() {
  $('permStatus').textContent = 'Meminta izin kamera & mikrofon...';
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) { try { await DeviceMotionEvent.requestPermission(); } catch {} }
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { await DeviceOrientationEvent.requestPermission(); } catch {} }
    if (stream) stream.getTracks().forEach(t => t.stop());
    const [w, h] = S.res.split('x').map(Number);
    // Minta resolusi setinggi mungkin; facingMode ideal agar tidak Overconstrained
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: S.facing }, width: { ideal: w }, height: { ideal: h }, aspectRatio: { ideal: w / h } },
      audio: true
    });
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    track = stream.getVideoTracks()[0];
    caps = track.getCapabilities ? track.getCapabilities() : {};
    settings = track.getSettings ? track.getSettings() : {};
    // Kunci fokus/eksposur kontinu biar tajam
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous', exposureMode: 'continuous', whiteBalanceMode: 'continuous' }] }); } catch {}
    // Info resolusi ASLI (bukan yang dipilih) — ini yang menentukan ketajaman
    const rw = settings.width || video.videoWidth, rh = settings.height || video.videoHeight;
    // Cek kemampuan foto sensor penuh (biasanya jauh lebih besar dari video)
    photoMax = null;
    try {
      if ('ImageCapture' in window) {
        imgCap = new ImageCapture(track);
        const pc = await imgCap.getPhotoCapabilities();
        if (pc.imageWidth && pc.imageWidth.max) photoMax = { w: pc.imageWidth.max, h: pc.imageHeight.max };
      } else imgCap = null;
    } catch { imgCap = null; }
    const fotoInfo = photoMax ? ` • foto ${photoMax.w}×${photoMax.h}` : '';
    $('hdBadge').textContent = `${rw}×${rh}${photoMax ? ' 📸' : ''}`;
    $('hdBadge').title = `Video ${rw}×${rh}${fotoInfo}. Hasil foto pakai ${imgCap ? 'sensor penuh' : 'frame video'}.`;
    if (caps.zoom) { $('zoom').min = caps.zoom.min; $('zoom').max = Math.min(caps.zoom.max, 10); $('zoom').step = caps.zoom.step || 0.1; }
    applyRatioMask();
  } catch (e) { $('permStatus').textContent = 'Izin kamera ditolak: ' + e.message; return false; }
  $('permStatus').textContent = 'Meminta izin lokasi...';
  requestGPS();
  return true;
}
function requestGPS() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.watchPosition(async p => {
    gps.lat = p.coords.latitude; gps.lon = p.coords.longitude; gps.acc = p.coords.accuracy;
    $('gpsInfo').textContent = `📍 ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)} (±${Math.round(gps.acc)}m)`;
    if (!gps._t || Date.now() - gps._t > 25000) { gps._t = Date.now(); await reverseStreet(); }
    updateStamp();
  }, () => { $('lsStreet').textContent = 'Lokasi tidak aktif'; }, { enableHighAccuracy: true });
}
async function reverseStreet() {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${gps.lat}&lon=${gps.lon}&format=jsonv2&addressdetails=1&accept-language=id`, { headers: { Accept: 'application/json' } });
    const j = await r.json(); const a = j.address || {};
    const road = a.road || a.pedestrian || a.footway || '';
    const num = a.house_number ? ' No. ' + a.house_number : '';
    const vil = a.village || a.suburb || a.neighbourhood || a.hamlet || '';
    const dis = a.city_district || a.district || '';
    const city = a.city || a.town || a.regency || a.county || a.state || '';
    const parts = [];
    if (road) parts.push(road + num);
    if (vil) parts.push(vil);
    if (dis && dis !== vil) parts.push(dis);
    if (city) parts.push(city);
    gps.street = parts.length ? parts.join(', ') : (j.display_name || '').split(',').slice(0, 3).join(',');
    gps.full = j.display_name || '';
  } catch { gps.street = `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}`; }
}
function fmtTimemark(d = new Date()) {
  const hari = d.toLocaleDateString('id-ID', { weekday: 'long' });
  const tgl = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replaceAll(':', '.');
  return `${hari}, ${tgl} ${jam}`;
}
function compassStr() {
  if (heading == null) return '';
  const dirs = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];
  return ` ${Math.round(heading)}° ${dirs[Math.round(heading / 45) % 8]}`;
}
function updateStamp() {
  $('lsStreet').textContent = gps.street || 'Mencari nama jalan...';
  let d = fmtTimemark() + compassStr();
  if (gps.lat != null) d += `\n${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
  const c = $('customText').value.trim();
  if (c) d += `\n${c}`;
  $('lsDate').innerText = d;
}
setInterval(updateStamp, 1000);
$('customText').addEventListener('input', updateStamp);
$('allowBtn').onclick = async () => { if (await requestAll()) { $('permModal').classList.add('hidden'); $('app').classList.remove('hidden'); toast('Kamera siap 📷'); } };
window.addEventListener('load', async () => { try { if (await requestAll()) { $('permModal').classList.add('hidden'); $('app').classList.remove('hidden'); } } catch {} });

// ---------- UI ----------
$('settingsBtn').onclick = () => $('sheet').classList.remove('hidden');
$('closeSheet').onclick = () => $('sheet').classList.add('hidden');
$('gridBtn').onclick = () => { $('grid').classList.toggle('hidden'); };
$('switchBtn').onclick = async () => { S.facing = S.facing === 'environment' ? 'user' : 'environment'; await requestAll(); toast(S.facing === 'user' ? '🤳 Kamera depan' : '📷 Kamera belakang'); };
$('flashBtn').onclick = async () => {
  try {
    if (!track || !caps.torch) return toast('Flash tidak didukung di perangkat ini');
    S.torch = !S.torch;
    await track.applyConstraints({ advanced: [{ torch: S.torch }] });
    $('flashBtn').style.background = S.torch ? '#f59e0b' : '';
  } catch (e) { toast(e.message); }
};
$('resolution').onchange = e => { S.res = e.target.value; requestAll(); };
$('ratio').onchange = e => { S.ratio = e.target.value; applyRatioMask(); };
$('filter').onchange = e => { S.filter = e.target.value; video.style.filter = filterCss(S.filter, false); };
function filterCss(f, capture) {
  if (S.mode === 'doc') return 'grayscale(1) contrast(1.35) brightness(1.08)';
  if (S.mode === 'night' || f === 'night') return 'brightness(1.4) contrast(1.18) saturate(1.25)';
  if (f === 'vivid') return 'saturate(1.6) contrast(1.15)';
  if (f === 'bw') return 'grayscale(1) contrast(1.1)';
  return 'none';
}
function applyRatioMask() {
  // Masking preview agar WYSIWYG dengan hasil crop
  const top = $('ratioMaskTop'), bot = $('ratioMaskBottom');
  top.style.display = bot.style.display = 'none';
  if (S.ratio === 'full' || !video.videoWidth) return;
  const vw = innerWidth, vh = $('app').clientHeight;
  let target = S.ratio === '1:1' ? 1 : S.ratio === '4:3' ? 3 / 4 : 9 / 16;
  let h = vw / target;
  if (h > vh) h = vh;
  const bar = (vh - h) / 2;
  top.style.display = bot.style.display = 'block';
  top.style.height = bar + 'px'; bot.style.height = bar + 'px';
}
window.addEventListener('resize', applyRatioMask);
video.addEventListener('loadedmetadata', applyRatioMask);
$('zoom').oninput = async e => {
  zoomV = Number(e.target.value);
  $('zoomVal').textContent = zoomV.toFixed(1) + 'x';
  try { if (track && caps.zoom) await track.applyConstraints({ advanced: [{ zoom: zoomV }] }); else video.style.transform = `scale(${zoomV})`; } catch {}
};
function bindToggle(id, key, on, off) { $(id).onclick = () => { S[key] = !S[key]; $(id).textContent = S[key] ? on : off; $(id).classList.toggle('on', S[key]); }; }
bindToggle('tStab', 'stab', '📳 Stabil ON', '📳 Stabil OFF');
bindToggle('tBlur', 'blur', '✨ Anti-Blur ON', '✨ Anti-Blur OFF');
bindToggle('tStamp', 'stamp', '🕒 Timestamp ON', '🕒 Timestamp OFF');
bindToggle('tMirror', 'mirror', '🪞 Mirror ON', '🪞 Mirror OFF');
bindToggle('tSharp', 'sharpen', '🗡️ Penajaman ON', '🗡️ Penajaman OFF');
// Mode strip
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#modes button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); S.mode = b.dataset.mode;
  video.style.filter = filterCss(S.filter, false);
  const isVid = S.mode === 'video';
  $('videoBtn').classList.toggle('hidden', !isVid);
  $('photoBtn').style.background = isVid ? '#ef4444' : '#fff';
  toast({ photo: '📷 Mode Foto HD', burst: '📸 Burst: 5 foto sekaligus', doc: '📄 Mode Dokumen', night: '🌙 Mode Malam', video: '🎥 Mode Video' }[S.mode]);
});
// Tap fokus + kunci
$('app').addEventListener('click', async e => {
  if (e.target.closest('button') || e.target.closest('#sheet') || e.target.closest('#galleryModal') || e.target.closest('#modes')) return;
  const b = $('focusBox');
  b.style.left = (e.clientX - 38) + 'px'; b.style.top = (e.clientY - 38) + 'px';
  b.classList.remove('hidden'); setTimeout(() => b.classList.add('hidden'), 900);
  try { if (track && caps.focusMode) await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }); } catch {}
});
// Double-tap zoom 1x/2x
let lastTap = 0;
$('app').addEventListener('touchend', async e => {
  const now = Date.now();
  if (now - lastTap < 300 && !e.target.closest('button')) {
    zoomV = zoomV > 1.5 ? 1 : 2;
    $('zoom').value = zoomV; $('zoomVal').textContent = zoomV.toFixed(1) + 'x';
    try { if (track && caps.zoom) await track.applyConstraints({ advanced: [{ zoom: zoomV }] }); else video.style.transform = `scale(${zoomV})`; } catch {}
  }
  lastTap = now;
});
// Tombol volume / spasi = shutter
document.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); mainShutter(); } });

// ---------- STABIL + KOMPAS ----------
window.addEventListener('devicemotion', e => {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const mag = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z - 9.8);
  motionE = motionE * 0.85 + Math.min(mag, 20) * 0.15;
  stability = Math.max(0, Math.min(100, 100 - motionE * 9));
}, true);
window.addEventListener('deviceorientationabsolute', e => { if (e.alpha != null) { heading = 360 - e.alpha; $('compass').textContent = Math.round(heading) + '°'; } }, true);
window.addEventListener('deviceorientation', e => { if (e.alpha != null && heading == null && e.webkitCompassHeading != null) { heading = e.webkitCompassHeading; $('compass').textContent = Math.round(heading) + '°'; } }, true);
setInterval(() => {
  if (!video.videoWidth) return;
  window._stab = stability;
  $('stabDot').style.color = !S.stab ? '#666' : stability > 70 ? '#22c55e' : stability > 40 ? '#f59e0b' : '#ef4444';
}, 500);

// ---------- SKOR KETAJAMAN (Laplacian variance, benar) ----------
function sharpScore(canvas) {
  const w = 160, h = Math.max(1, Math.round(160 * canvas.height / canvas.width));
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  workCanvas.width = w; workCanvas.height = h;
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (d.data[i * 4] + d.data[i * 4 + 1] + d.data[i * 4 + 2]) / 3;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    sum += lap; sum2 += lap * lap; n++;
  }
  const m = sum / n;
  return sum2 / n - m * m;
}
function grabVideoFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  capCanvas.width = vw; capCanvas.height = vh;
  const ctx = capCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.filter = filterCss(S.filter, true) === 'none' ? 'none' : filterCss(S.filter, true);
  if (S.facing === 'user' && S.mirror) { ctx.translate(vw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.filter = 'none';
  return capCanvas;
}
// Foto resolusi sensor penuh (jauh lebih tajam dari frame video)
async function captureFullRes() {
  if (imgCap) {
    try {
      const settings = photoMax ? { imageWidth: photoMax.w, imageHeight: photoMax.h } : undefined;
      const blob = settings ? await imgCap.takePhoto(settings) : await imgCap.takePhoto();
      const bmp = await createImageBitmap(blob);
      capCanvas.width = bmp.width; capCanvas.height = bmp.height;
      const ctx = capCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      if (S.facing === 'user' && S.mirror) { ctx.translate(bmp.width, 0); ctx.scale(-1, 1); }
      // filter manual untuk blob (ctx.filter didukung Chrome)
      try { ctx.filter = filterCss(S.filter, true) === 'none' ? 'none' : filterCss(S.filter, true); } catch {}
      ctx.drawImage(bmp, 0, 0);
      try { ctx.filter = 'none'; } catch {}
      bmp.close();
      return { canvas: capCanvas, fullRes: true, w: capCanvas.width, h: capCanvas.height };
    } catch (e) { /* fallback ke frame */ }
  }
  const c = grabVideoFrame();
  return { canvas: c, fullRes: false, w: c.width, h: c.height };
}
function cropRatio(src) {
  const target = S.ratio === 'full' ? null : S.ratio === '1:1' ? 1 : S.ratio === '4:3' ? 3 / 4 : 9 / 16;
  if (!target) return src;
  const sw = src.width, sh = src.height;
  let cw = sw, ch = Math.round(sw / target);
  if (ch > sh) { ch = sh; cw = Math.round(sh * target); }
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, cw, ch);
  return out;
}
function sharpenSmall(canvas) {
  // Penajaman ringan hanya untuk file <= 3MP agar tidak berat di HP
  if (!S.sharpen || canvas.width * canvas.height > 3_000_000) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = new Uint8ClampedArray(d.data);
  const W = canvas.width, k = 0.35;
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < W - 1; x++) {
    for (let c = 0; c < 3; c++) {
      const i = (y * W + x) * 4 + c;
      const lap = 4 * src[i] - src[i - 4] - src[i + 4] - src[i - W * 4] - src[i + W * 4];
      d.data[i] = Math.max(0, Math.min(255, src[i] + lap * k));
    }
  }
  ctx.putImageData(d, 0, 0);
}
function burnTimemark(ctx, W, H) {
  if (!S.stamp) return;
  const street = gps.street || 'Mencari lokasi...';
  const date = fmtTimemark() + compassStr();
  const coord = gps.lat != null ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : '';
  const note = $('customText').value.trim();
  const barH = H * 0.15;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H - barH, W, barH);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(W * 0.038)}px system-ui,sans-serif`;
  ctx.fillText(street.slice(0, 64), W * 0.03, H - barH + H * 0.015, W * 0.94);
  ctx.fillStyle = '#ffd54f';
  ctx.font = `${Math.round(W * 0.032)}px system-ui,sans-serif`;
  ctx.fillText(date, W * 0.03, H - barH + H * 0.06, W * 0.94);
  if (coord) { ctx.fillStyle = '#fff'; ctx.fillText(coord, W * 0.03, H - barH + H * 0.10, W * 0.94); }
  if (note) { ctx.fillStyle = '#fff'; ctx.fillText(note.slice(0, 56), W * 0.03, H - barH - H * 0.035, W * 0.94); }
}
async function lockFocus() { try { if (track && caps.focusMode) { await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }); await new Promise(r => setTimeout(r, 350)); } } catch {} }

async function takePhotoHD() {
  const t = Number($('timer').value);
  if (t > 0) for (let i = t; i > 0; i--) { $('countdown').textContent = i; $('countdown').classList.remove('hidden'); await new Promise(r => setTimeout(r, 1000)); }
  $('countdown').classList.add('hidden');
  if (S.stab && stability < 20) { toast('🛑 Terlalu goyang, tahan dulu...'); await new Promise(r => setTimeout(r, 700)); }
  await lockFocus();
  const saveOne = (canvas, tag) => {
    const c = cropRatio(canvas);
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    tmp.getContext('2d').drawImage(c.width === canvas.width && c.height === canvas.height ? canvas : c, 0, 0);
    sharpenSmall(tmp);
    burnTimemark(tmp.getContext('2d'), tmp.width, tmp.height);
    const url = tmp.toDataURL('image/jpeg', 0.97); // kualitas 97, bukan 92
    const score = Math.round(sharpScore(tmp));
    $('sharpInfo').textContent = `tajam: ${score} • ${tmp.width}×${tmp.height}${tag || ''}`;
    addGal({ type: 'photo', url, time: new Date(), w: tmp.width, h: tmp.height, score });
  };
  if (S.mode === 'burst') {
    toast('📸 Burst 5x...');
    const frames = [];
    for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 120)); const c = grabVideoFrame(); frames.push({ url: c.toDataURL('image/jpeg', 0.95), score: sharpScore(c), w: c.width, h: c.height }); }
    frames.sort((a, b) => b.score - a.score);
    // simpan 3 terbaik
    for (let i = 0; i < 3; i++) {
      const img = new Image(); img.src = frames[i].url; await new Promise(r => img.onload = r);
      const cc = document.createElement('canvas'); cc.width = img.naturalWidth; cc.height = img.naturalHeight;
      cc.getContext('2d').drawImage(img, 0, 0);
      saveOne(cc, ' • burst');
    }
    toast(`✅ Burst: 3 terbaik (skor ${Math.round(frames[0].score)})`);
    return;
  }
  // Foto tunggal: coba sensor penuh, ulangi maks 3x jika blur dan Anti-Blur ON
  let best = null, bestScore = -1, tries = S.blur ? 3 : 1;
  toast(imgCap ? '📸 Mengambil resolusi penuh...' : '📸 Mengambil frame HD...');
  for (let i = 0; i < tries; i++) {
    const { canvas, fullRes } = await captureFullRes();
    const s = sharpScore(canvas);
    if (s > bestScore) {
      bestScore = s;
      best = document.createElement('canvas'); best.width = canvas.width; best.height = canvas.height;
      best.getContext('2d').drawImage(canvas, 0, 0);
      best._full = fullRes;
    }
    if (s > 60 || !S.blur) break;
    await new Promise(r => setTimeout(r, 250));
  }
  saveOne(best, best._full ? ' • full-res' : ' • frame');
  toast(best._full ? '📸 Tersimpan full-res tajam ✅' : '📸 Tersimpan (frame video)');
}
function mainShutter() { if (S.mode === 'video') toggleVideo(); else takePhotoHD(); }
$('photoBtn').onclick = mainShutter;

// ---------- VIDEO (tanpa crop berlebih) ----------
$('videoBtn').onclick = toggleVideo;
function recStr() { const s = Math.floor((Date.now() - recStart) / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function toggleVideo() {
  if (recording) {
    recording.mr.stop(); recording = null; clearInterval(recTick);
    $('recTimer').classList.add('hidden'); $('photoBtn').style.background = S.mode === 'video' ? '#ef4444' : '#fff';
    toast('🎥 Tersimpan'); return;
  }
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const rc = document.createElement('canvas'); rc.width = vw; rc.height = vh;
  const rx = rc.getContext('2d');
  const loop = () => {
    if (!recording) return;
    rx.save();
    rx.filter = filterCss(S.filter, true) === 'none' ? 'none' : filterCss(S.filter, true);
    // EIS ringan: crop 4% saja (bukan 8%) agar tidak blur
    if (S.stab) { const c = 0.96; rx.drawImage(video, vw * (1 - c) / 2, vh * (1 - c) / 2, vw * c, vh * c, 0, 0, vw, vh); }
    else rx.drawImage(video, 0, 0, vw, vh);
    rx.restore(); rx.filter = 'none';
    burnTimemark(rx, vw, vh);
    requestAnimationFrame(loop);
  };
  const rs = rc.captureStream(30);
  (stream ? stream.getAudioTracks() : []).forEach(t => rs.addTrack(t));
  const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  const mr = new MediaRecorder(rs, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
  const ch = [];
  mr.ondataavailable = e => { if (e.data.size) ch.push(e.data); };
  mr.onstop = () => addGal({ type: 'video', url: URL.createObjectURL(new Blob(ch, { type: mime })), time: new Date(), mime });
  recording = { mr }; mr.start(500); recStart = Date.now();
  $('recTimer').classList.remove('hidden');
  recTick = setInterval(() => $('recTimer').textContent = '● ' + recStr(), 500);
  loop(); toast('🎥 Merekam...');
}

// ---------- GALERI + SHARE ----------
function addGal(g) { gallery.unshift(g); $('gCount').textContent = gallery.length; renderGal(); }
function renderGal() {
  $('galleryGrid').innerHTML = '';
  gallery.forEach((g, i) => {
    const d = document.createElement('div'); d.className = 'g-item';
    const ext = g.type === 'photo' ? 'jpg' : (g.mime?.includes('mp4') ? 'mp4' : 'webm');
    const label = g.w ? `<small style="color:#9ca3af">${g.w}×${g.h} skor ${g.score}</small>` : '';
    d.innerHTML = g.type === 'photo'
      ? `<img src="${g.url}"/>${label}<div class="g-foot"><a href="${g.url}" download="kamera-${g.time.getTime()}.${ext}">⬇️</a><button data-i="${i}">🗑️</button></div>`
      : `<video src="${g.url}" controls></video><div class="g-foot"><a href="${g.url}" download="kamera-${g.time.getTime()}.${ext}">⬇️</a><button data-i="${i}">🗑️</button></div>`;
    $('galleryGrid').appendChild(d);
  });
  $('galleryGrid').querySelectorAll('button').forEach(b => b.onclick = () => { gallery.splice(+b.dataset.i, 1); $('gCount').textContent = gallery.length; renderGal(); });
}
$('galleryBtn').onclick = () => $('galleryModal').classList.remove('hidden');
$('closeGallery').onclick = () => $('galleryModal').classList.add('hidden');
$('shareLast').onclick = async () => {
  if (!gallery.length) return toast('Belum ada hasil');
  try {
    const g = gallery[0];
    const r = await fetch(g.url); const blob = await r.blob();
    const file = new File([blob], `kamera.${g.type === 'photo' ? 'jpg' : 'mp4'}`, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Kamera HD' });
    else { const a = document.createElement('a'); a.href = g.url; a.download = 'kamera-hd'; a.click(); }
  } catch (e) { toast('Share gagal: ' + e.message); }
};
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
updateStamp();
