// Kamera HD v6.1 - instant capture, robust error handling
const $ = id => document.getElementById(id);
const video = $('video');
const capCanvas = $('captureCanvas');
const workCanvas = $('workCanvas');
const S = { stab: true, stamp: true, mirror: false, facing: 'environment', torch: false, res: '1920x1080', ratio: 'full', mode: 'photo', filter: 'none' };
let stream = null, track = null, caps = {};
let gallery = [];
let gps = { lat: null, lon: null, acc: null, street: '' };
let heading = null;
let stability = 100, motionE = 0;
let recording = null, recStart = 0, recTick = null;
let zoomV = 1;
let imgCap = null, photoMax = null;
let isNative = false;

function toast(m, ms) { ms = ms || 2200; const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(t._x); t._x = setTimeout(function() { t.classList.add('hidden'); }, ms); }
function fmtTimemark(d) { d = d || new Date(); return d.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replaceAll(':', '.'); }
function compassStr() { return heading == null ? '' : ' ' + Math.round(heading) + '\u00B0'; }

// ===== DETEKSI NATIVE =====
isNative = (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform());

// ===== INISIALISASI =====
window.addEventListener('load', function() {
  if (isNative) {
    // APK: cek Capacitor permissions, langsung buka kamera
    initCamera();
  } else {
    // Web: tampilkan loading, auto request izin
    $('loading').classList.remove('hidden');
    setTimeout(initCamera, 300);
  }
});

async function initCamera() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) { try { await DeviceMotionEvent.requestPermission(); } catch(e) {} }
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { await DeviceOrientationEvent.requestPermission(); } catch(e) {} }
    if (stream) stream.getTracks().forEach(function(t) { t.stop(); });
    var parts = S.res.split('x').map(Number);
    var w = parts[0], h = parts[1];
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: S.facing }, width: { ideal: w }, height: { ideal: h }, aspectRatio: { ideal: w / h } }, audio: true });
    video.srcObject = stream; await video.play();
    // Set video dimensions ke maksimal
    var vw = video.videoWidth || w, vh = video.videoHeight || h;
    track = stream.getVideoTracks()[0];
    caps = track.getCapabilities ? track.getCapabilities() : {};
    settings = track.getSettings ? track.getSettings() : {};
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous', exposureMode: 'continuous', whiteBalanceMode: 'continuous' }] }); } catch(e) {}
    photoMax = null; imgCap = null;
    try { if ('ImageCapture' in window) { imgCap = new ImageCapture(track); var pc = await imgCap.getPhotoCapabilities(); if (pc.imageWidth && pc.imageWidth.max) photoMax = { w: pc.imageWidth.max, h: pc.imageHeight.max }; } } catch(e) {}
    $('hdBadge').textContent = '' + vw + '\u00D7' + vh;
    $('hdBadge').title = 'Foto maks ' + (photoMax ? photoMax.w + '\u00D7' + photoMax.h : vw + '\u00D7' + vh);
    if (caps.zoom) { $('zoom').min = caps.zoom.min; $('zoom').max = Math.min(caps.zoom.max, 10); $('zoom').step = caps.zoom.step || 0.1; }
    applyRatioMask();
    // Sembunyikan loading, tampilkan app
    $('loading').style.display = 'none';
    $('app').classList.remove('hidden');
  } catch(e) {
    console.error('Camera init error:', e);
    $('permStatus').textContent = 'Gagal: ' + e.message;
    $('loading').innerHTML = '<div style="text-align:center"><div style="color:#ef4444;font-size:16px">\u2716 Kamera gagal dibuka</div><small style="color:#64748b;margin-top:8px;display:block">' + e.message + '</small><button onclick="location.reload()" style="margin-top:16px;background:#3b82f6;color:#fff;border:none;border-radius:10px;padding:10px 24px;cursor:pointer">Coba Lagi</button></div>';
  }
  requestGPS();
}

function requestGPS() {
  if (!('geolocation' in navigator)) { $('gpsInfo').textContent = 'GPS tidak didukung'; return; }
  navigator.geolocation.watchPosition(async function(p) {
    gps.lat = p.coords.latitude; gps.lon = p.coords.longitude; gps.acc = p.coords.accuracy;
    $('gpsInfo').textContent = '\uD83D\uDCCD ' + gps.lat.toFixed(5) + ', ' + gps.lon.toFixed(5) + ' (\u00B1' + Math.round(gps.acc) + 'm)';
    if (!gps._t || Date.now() - gps._t > 25000) { gps._t = Date.now(); await reverseStreet(); }
    updateStampUI();
  }, function(e) { $('lsStreet').textContent = 'Lokasi tidak aktif'; }, { enableHighAccuracy: true });
}
async function reverseStreet() {
  try {
    var url = 'https://nominatim.openstreetmap.org/reverse?lat=' + gps.lat + '&lon=' + gps.lon + '&format=jsonv2&addressdetails=1&accept-language=id';
    var r = await fetch(url, { headers: { Accept: 'application/json' } });
    var j = await r.json(); var a = j.address || {};
    var road = a.road || a.pedestrian || a.footway || '';
    var num = a.house_number ? ' No. ' + a.house_number : '';
    var vil = a.village || a.suburb || a.neighbourhood || a.hamlet || '';
    var dis = a.city_district || a.district || '';
    var city = a.city || a.town || a.regency || a.county || a.state || '';
    var parts = [];
    if (road) parts.push(road + num);
    if (vil) parts.push(vil);
    if (dis && dis !== vil) parts.push(dis);
    if (city) parts.push(city);
    gps.street = parts.length ? parts.join(', ') : (j.display_name || '').split(',').slice(0, 3).join(',');
  } catch(e) { gps.street = gps.lat.toFixed(5) + ', ' + gps.lon.toFixed(5); }
}
function updateStampUI() {
  if (!S.stamp) { $('liveStamp').classList.add('stamp-off'); return; }
  $('liveStamp').classList.remove('stamp-off');
  $('lsStreet').textContent = gps.street || 'Mencari nama jalan...';
  var d = fmtTimemark();
  if (heading != null) d += ' ' + Math.round(heading) + '\u00B0';
  if (gps.lat != null) d += '\n' + gps.lat.toFixed(6) + ', ' + gps.lon.toFixed(6);
  var c = $('customText').value.trim();
  if (c) d += '\n' + c;
  $('lsDate').innerText = d;
}
setInterval(updateStampUI, 1000);
$('customText').addEventListener('input', updateStampUI);

// ===== UI =====
$('settingsBtn').onclick = function() { $('sheet').classList.remove('hidden'); };
$('closeSheet').onclick = function() { $('sheet').classList.add('hidden'); };
$('gridBtn').onclick = function() { $('grid').classList.toggle('hidden'); };
$('switchCamBtn').onclick = async function() { S.facing = S.facing === 'environment' ? 'user' : 'environment'; await initCamera(); toast(S.facing === 'user' ? 'Depan' : 'Belakang'); };
$('flashToggle').onclick = async function() {
  try {
    if (!track || !caps.torch) return toast('Flash tidak didukung');
    S.torchOn = !S.torchOn;
    await track.applyConstraints({ advanced: [{ torch: S.torchOn }] });
    $('flashToggle').style.background = S.torchOn ? 'rgba(245,158,11,.3)' : '';
  } catch(e) { toast(e.message); }
};
$('resolution').onchange = function(e) { S.res = e.target.value; initCamera(); };
$('ratio').onchange = function(e) { S.ratio = e.target.value; applyRatioMask(); };
$('filter').onchange = function(e) { S.filter = e.target.value; video.style.filter = filterCss(); };
function filterCss() {
  if (S.mode === 'doc') return 'grayscale(1) contrast(1.35) brightness(1.08)';
  if (S.mode === 'night' || S.filter === 'night') return 'brightness(1.4) contrast(1.18) saturate(1.25)';
  if (S.filter === 'vivid') return 'saturate(1.6) contrast(1.15)';
  if (S.filter === 'bw') return 'grayscale(1) contrast(1.1)';
  return 'none';
}
function applyRatioMask() {
  var top = $('ratioMaskTop'), bot = $('ratioMaskBottom');
  top.style.display = bot.style.display = 'none';
  if (S.ratio === 'full' || !video.videoWidth) return;
  var vw = innerWidth, vh = $('app').clientHeight;
  var target = S.ratio === '1:1' ? 1 : S.ratio === '4:3' ? 3 / 4 : 9 / 16;
  var h = vw / target;
  if (h > vh) h = vh;
  var bar = (vh - h) / 2;
  top.style.display = bot.style.display = 'block';
  top.style.height = bar + 'px'; bot.style.height = bar + 'px';
}
window.addEventListener('resize', applyRatioMask);
video.addEventListener('loadedmetadata', applyRatioMask);
$('zoom').oninput = async function(e) {
  zoomV = Number(e.target.value);
  $('zoomVal').textContent = zoomV.toFixed(1) + 'x';
  try { if (track && caps.zoom) await track.applyConstraints({ advanced: [{ zoom: zoomV }] }); else video.style.transform = 'scale(' + zoomV + ')'; } catch(e) {}
};
function bindToggle(id, key, on, off) { $(id).onclick = function() { S[key] = !S[key]; $(id).textContent = S[key] ? on : off; $(id).classList.toggle('on', S[key]); }; }
bindToggle('tStab', 'stab', 'Stabil', 'Stabil');
bindToggle('tStamp', 'stamp', 'Timestamp', 'Timestamp');
bindToggle('tMirror', 'mirror', 'Mirror', 'Mirror');
document.querySelectorAll('#modes button').forEach(function(b) { b.onclick = function() {
  document.querySelectorAll('#modes button').forEach(function(x) { x.classList.remove('on'); });
  b.classList.add('on'); S.mode = b.dataset.mode;
  video.style.filter = filterCss();
  $('videoBtn').classList.toggle('hidden', S.mode !== 'video');
  var msgs = { photo: 'Foto HD', burst: 'Burst', doc: 'Dokumen', night: 'Malam', video: 'Video' };
  toast(msgs[S.mode]);
}; });
$('app').addEventListener('click', async function(e) {
  if (e.target.closest('button') || e.target.closest('#sheet') || e.target.closest('#galleryModal') || e.target.closest('#modes')) return;
  var b = $('focusBox');
  b.style.left = (e.clientX - 38) + 'px'; b.style.top = (e.clientY - 38) + 'px';
  b.classList.remove('hidden'); setTimeout(function() { b.classList.add('hidden'); }, 900);
  try { if (track && caps.focusMode) await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }); } catch(e) {}
});
var lastTap = 0;
$('app').addEventListener('touchend', async function(e) {
  var now = Date.now();
  if (now - lastTap < 300 && !e.target.closest('button')) {
    zoomV = zoomV > 1.5 ? 1 : 2;
    $('zoom').value = zoomV; $('zoomVal').textContent = zoomV.toFixed(1) + 'x';
    try { if (track && caps.zoom) await track.applyConstraints({ advanced: [{ zoom: zoomV }] }); else video.style.transform = 'scale(' + zoomV + ')'; } catch(e) {}
  }
  lastTap = now;
});
document.addEventListener('keydown', function(e) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); mainShutter(); } });

// ===== STABIL + KOMPAS =====
window.addEventListener('devicemotion', function(e) {
  var a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  var mag = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z - 9.8);
  motionE = motionE * 0.85 + Math.min(mag, 20) * 0.15;
  stability = Math.max(0, Math.min(100, 100 - motionE * 9));
}, true);
window.addEventListener('deviceorientationabsolute', function(e) { if (e.alpha != null) { heading = 360 - e.alpha; $('compass').textContent = Math.round(heading) + '\u00B0'; } }, true);
window.addEventListener('deviceorientation', function(e) { if (e.alpha != null && heading == null && e.webkitCompassHeading != null) { heading = e.webkitCompassHeading; $('compass').textContent = Math.round(heading) + '\u00B0'; } }, true);
setInterval(function() { if (!video.videoWidth) return; window._stab = stability; $('stabDot').style.color = !S.stab ? '#666' : stability > 70 ? '#22c55e' : stability > 40 ? '#f59e0b' : '#ef4444'; }, 500);

// ===== KETAJAMAN (ringan 64x64) =====
function sharpScore(canvas) {
  var w = 64, h = Math.max(1, Math.round(64 * canvas.height / canvas.width));
  var ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  workCanvas.width = w; workCanvas.height = h;
  ctx.drawImage(canvas, 0, 0, w, h);
  var d = ctx.getImageData(0, 0, w, h);
  var g = new Float32Array(w * h);
  for (var i = 0; i < w * h; i++) g[i] = (d.data[i * 4] + d.data[i * 4 + 1] + d.data[i * 4 + 2]) / 3;
  var sum = 0, sum2 = 0, n = 0;
  for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
    var idx = y * w + x;
    var lap = 4 * g[idx] - g[idx - 1] - g[idx + 1] - g[idx - w] - g[idx + w];
    sum += lap; sum2 += lap * lap; n++;
  }
  var m = sum / n;
  return sum2 / n - m * m;
}
function grabVideoFrame() {
  var vw = video.videoWidth, vh = video.videoHeight;
  capCanvas.width = vw; capCanvas.height = vh;
  var ctx = capCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  var f = filterCss();
  ctx.filter = f === 'none' ? 'none' : f;
  if (S.facing === 'user' && S.mirror) { ctx.translate(vw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.filter = 'none';
  return capCanvas;
}
async function captureFullRes() {
  if (imgCap && photoMax) {
    try {
      var s = { imageWidth: photoMax.w, imageHeight: photoMax.h };
      var blob = await imgCap.takePhoto(s);
      var bmp = await createImageBitmap(blob);
      capCanvas.width = bmp.width; capCanvas.height = bmp.height;
      var ctx = capCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      if (S.facing === 'user' && S.mirror) { ctx.translate(bmp.width, 0); ctx.scale(-1, 1); }
      try { ctx.filter = filterCss() === 'none' ? 'none' : filterCss(); } catch(e) {}
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return { canvas: capCanvas, fullRes: true };
    } catch(e) {
      // Fallback ke video frame jika ImageCapture gagal
      console.warn('ImageCapture failed, falling back to video frame:', e);
    }
  }
  var c = grabVideoFrame();
  return { canvas: c, fullRes: false };
}
function cropRatio(src) {
  var target = S.ratio === 'full' ? null : S.ratio === '1:1' ? 1 : S.ratio === '4:3' ? 3 / 4 : 9 / 16;
  if (!target) return src;
  var sw = src.width, sh = src.height;
  var cw = sw, ch = Math.round(sw / target);
  if (ch > sh) { ch = sh; cw = Math.round(sh * target); }
  var out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, cw, ch);
  return out;
}
function burnTimemark(ctx, W, H) {
  if (!S.stamp) return;
  var street = gps.street || 'Mencari lokasi...';
  var date = fmtTimemark();
  var coord = gps.lat != null ? gps.lat.toFixed(6) + ', ' + gps.lon.toFixed(6) : '';
  var note = $('customText').value.trim();
  var barH = H * 0.15;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H - barH, W, barH);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.font = '700 ' + Math.round(W * 0.038) + 'px system-ui,sans-serif';
  ctx.fillText(street.slice(0, 64), W * 0.03, H - barH + H * 0.015, W * 0.94);
  ctx.fillStyle = '#fbbf24';
  ctx.font = Math.round(W * 0.032) + 'px system-ui,sans-serif';
  ctx.fillText(date, W * 0.03, H - barH + H * 0.06, W * 0.94);
  if (coord) { ctx.fillStyle = '#fff'; ctx.fillText(coord, W * 0.03, H - barH + H * 0.10, W * 0.94); }
  if (note) { ctx.fillStyle = '#fff'; ctx.fillText(note.slice(0, 56), W * 0.03, H - barH - H * 0.035, W * 0.94); }
}
async function lockFocus() { try { if (track && caps.focusMode) { await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }); await new Promise(function(r) { setTimeout(r, 200); }); } } catch(e) {} }

// ===== SIMPAN KE GALERI (background, non-blocking) =====
async function saveToGallery(blob, filename) {
  var isApk = isNative || /android|capacitor/i.test(navigator.userAgent);
  if (isApk) {
    try {
      var Filesystem = Capacitor.Plugins.Filesystem;
      var Directory = Capacitor.Plugins.Directory;
      var base64 = await new Promise(function(res, rej) {
        var reader = new FileReader();
        reader.onload = function() { res(reader.result); };
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      await Filesystem.writeFile({ path: 'KameraHD/' + filename, data: base64, directory: Directory.Pictures });
      return;
    } catch(e) { /* fallback download */ }
  }
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ===== AMBIL FOTO - INSTAN =====
async function takePhotoHD() {
  var t = Number($('timer').value);
  if (t > 0) for (var i = t; i > 0; i--) { $('countdown').textContent = i; $('countdown').classList.remove('hidden'); await new Promise(function(r) { setTimeout(r, 1000); }); }
  $('countdown').classList.add('hidden');
  if (S.stab && stability < 20) { toast('Terlalu goyang!'); await new Promise(function(r) { setTimeout(r, 500); }); }
  await lockFocus();
  // Capture sekali saja
  var result = await captureFullRes();
  var canvas = result.canvas;
  // Burn timemark langsung ke canvas penuh (sudah penuh resolusi)
  burnTimemark(canvas.getContext('2d'), canvas.width, canvas.height);
  var fname = 'kamera-' + Date.now() + '.jpg';
  var finalBlob = await new Promise(function(r) { canvas.toBlob(r, 'image/jpeg', 0.97); });
  var url = URL.createObjectURL(finalBlob);
  var score = Math.round(sharpScore(canvas) / 100);
  addGal({ type: 'photo', url: url, time: new Date(), w: canvas.width, h: canvas.height, score: score });
  // Background save - non-blocking
  setTimeout(function() { saveToGallery(finalBlob, fname); }, 100);
  setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
  toast(result.fullRes ? 'Tersimpan' : 'Tersimpan');
}
function mainShutter() { if (S.mode === 'video') toggleVideo(); else takePhotoHD(); }
$('photoBtn').onclick = mainShutter;

// ===== BURST =====
async function takeBurst() {
  toast('Burst...');
  var frames = [];
  for (var i = 0; i < 5; i++) { await new Promise(function(r) { setTimeout(r, 80); }); frames.push(grabVideoFrame()); }
  var scored = frames.map(function(f) { return { canvas: f, score: sharpScore(f) }; });
  scored.sort(function(a, b) { return b.score - a.score; });
  var best = scored.slice(0, 3);
  for (var j = 0; j < best.length; j++) {
    var c = cropRatio(best[j].canvas);
    var tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    tmp.getContext('2d').drawImage(c, 0, 0);
    burnTimemark(tmp.getContext('2d'), tmp.width, tmp.height);
    var url = tmp.toDataURL('image/jpeg', 0.97);
    addGal({ type: 'photo', url: url, time: new Date(), w: tmp.width, h: tmp.height, score: Math.round(best[j].score) });
  }
  toast('Burst: 3 terbaik');
}

// ===== VIDEO =====
$('videoBtn').onclick = toggleVideo;
function recStr() { var s = Math.floor((Date.now() - recStart) / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function toggleVideo() {
  if (recording) {
    recording.mr.stop(); recording = null; clearInterval(recTick);
    $('recTimer').classList.add('hidden'); toast('Tersimpan'); return;
  }
  var vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  var rc = document.createElement('canvas'); rc.width = vw; rc.height = vh;
  var rx = rc.getContext('2d');
  var loop = function() {
    if (!recording) return;
    rx.save();
    var f = filterCss();
    rx.filter = f === 'none' ? 'none' : f;
    rx.drawImage(video, 0, 0, vw, vh);
    rx.restore(); rx.filter = 'none';
    burnTimemark(rx, vw, vh);
    requestAnimationFrame(loop);
  };
  var rs = rc.captureStream(30);
  if (stream) stream.getAudioTracks().forEach(function(t) { rs.addTrack(t); });
  var mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  var mr = new MediaRecorder(rs, { mimeType: mime, videoBitsPerSecond: 12000000 });
  var ch = [];
  mr.ondataavailable = function(e) { if (e.data.size) ch.push(e.data); };
  mr.onstop = async function() {
    var blob = new Blob(ch, { type: mime });
    var url = URL.createObjectURL(blob);
    var fname = 'kamera-' + Date.now() + '.mp4';
    addGal({ type: 'video', url: url, time: new Date(), mime: mime });
    setTimeout(function() { saveToGallery(blob, fname); }, 100);
    toast('Tersimpan di Galeri');
  };
  recording = { mr: mr }; mr.start(500); recStart = Date.now();
  $('recTimer').classList.remove('hidden');
  recTick = setInterval(function() { $('recTimer').textContent = '\u25CF ' + recStr(); }, 500);
  loop(); toast('Merekam...');
}

// ===== GALERI =====
function addGal(g) { gallery.unshift(g); $('gCount').textContent = gallery.length; renderGal(); }
function renderGal() {
  $('galleryGrid').innerHTML = '';
  gallery.forEach(function(g, i) {
    var d = document.createElement('div'); d.className = 'g-item';
    var ext = g.type === 'photo' ? 'jpg' : (g.mime && g.mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm');
    var info = g.w ? '<div class="g-info">' + g.w + '\u00D7' + g.h + '</div>' : '';
    var imgHtml = g.type === 'photo'
      ? '<img src="' + g.url + '"/>' + info + '<div class="g-foot"><a href="' + g.url + '" download="kamera-' + g.time.getTime() + '.' + ext + '">\u2B07\uFE0F</a><button data-i="' + i + '">Hapus</button></div>'
      : '<video src="' + g.url + '" controls></video>' + info + '<div class="g-foot"><a href="' + g.url + '" download="kamera-' + g.time.getTime() + '.' + ext + '">\u2B07\uFE0F</a><button data-i="' + i + '">Hapus</button></div>';
    d.innerHTML = imgHtml;
    $('galleryGrid').appendChild(d);
  });
  $('galleryGrid').querySelectorAll('button').forEach(function(b) { b.onclick = function() { gallery.splice(+b.dataset.i, 1); $('gCount').textContent = gallery.length; renderGal(); }; });
}
$('galleryBtn').onclick = function() { $('galleryModal').classList.remove('hidden'); };
$('closeGallery').onclick = function() { $('galleryModal').classList.add('hidden'); };
if ('serviceWorker' in navigator) window.addEventListener('load', function() { navigator.serviceWorker.register('sw.js').catch(function() {}); });
updateStampUI();
