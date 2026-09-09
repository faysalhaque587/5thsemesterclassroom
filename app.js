'use strict';

/* ================================================================
   ৫ম ক্লাসরুম (CSE 5th Semester) — Study Material Sharing App
   ছবি ও PDF আপলোড (শিক্ষক) + সবাই দেখতে পারবে
   ================================================================ */

/* ---------- কনফিগারেশন (দরকার হলে এখানে বদলান) ---------- */
const SUPABASE_URL = 'https://zuumikjjxsqdjvtkzypi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MYZ15-sPwBCnWiU0nXsezA_NvXmg05o';
const ADMIN_PIN    = '511789';            // 🔑 App Creator (Fahim)-এর PIN — নিজের পছন্দমতো বদলে নিন
const CREATOR_FB   = 'https://www.facebook.com/share/1YkNXjq9Qw/';  // 👤 App Creator-এর Facebook লিংক
const TABLE        = 'classroom_posts';   // ডাটাবেস টেবিল
const BUCKET       = 'classroom-files';   // স্টোরেজ বাকেট
const MAX_MB       = 200;                 // প্রতি ফাইলের সর্বোচ্চ সাইজ (MB)

const DEFAULT_SUBJECTS = [
  'Peripheral and Interfacing',
  'Peripheral and Interfacing (Lab)',
  'Data and Telecommunications',
  'Data and Telecommunications (Lab)',
  'Operating System',
  'Operating System (Lab)',
  'Economics'
];

/* ---------- স্টেট ---------- */
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let posts = [];
let activeSubject = 'all';
let searchText = '';
let isAdmin = sessionStorage.getItem('c5-admin') === '1';
let pendingFiles = [];
let uploading = false;
let lbImages = [];
let lbIndex = 0;
let firstLoadDone = false;

/* ---------- ছোট হেল্পার ---------- */
const $ = id => document.getElementById(id);
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toBn = v => String(v).replace(/\d/g, d => BN_DIGITS[d]);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function bnBytes(n) {
  if (n == null) return '';
  if (n < 1024) return toBn(n) + ' B';
  if (n < 1048576) return toBn((n / 1024).toFixed(1)) + ' KB';
  return toBn((n / 1048576).toFixed(1)) + ' MB';
}

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'এইমাত্র';
  if (m < 60) return toBn(m) + ' মিনিট আগে';
  const h = Math.floor(m / 60);
  if (h < 24) return toBn(h) + ' ঘণ্টা আগে';
  const d = Math.floor(h / 24);
  if (d === 1) return 'গতকাল';
  if (d < 30) return toBn(d) + ' দিন আগে';
  try { return new Date(iso).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch (e) { return new Date(iso).toLocaleDateString(); }
}

let toastTimer = null;
function toast(msg, type) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function fileUrl(path, download) {
  if (!sb || !path) return '#';
  const res = sb.storage.from(BUCKET).getPublicUrl(path, download ? { download: true } : undefined);
  return (res && res.data && res.data.publicUrl) || '#';
}

const isImageFile = f =>
  (f.type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(f.name || '');

const isPdfFile = f =>
  (f.type || '') === 'application/pdf' || /\.pdf$/i.test(f.name || '');

/* ---------- ডাটা লোড ---------- */
async function loadPosts(silent) {
  if (!sb) {
    $('setup-warning').classList.remove('hidden');
    posts = [];
    renderChips();
    setState('empty');
    return;
  }
  if (!silent) setState('loading');
  try {
    const { data, error } = await sb.from(TABLE).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    posts = Array.isArray(data) ? data : [];
    firstLoadDone = true;
    $('setup-warning').classList.add('hidden');
    renderChips();
    renderFeed();
  } catch (e) {
    console.error(e);
    if (!firstLoadDone) {
      $('setup-warning').classList.remove('hidden');
      posts = [];
      renderChips();
      setState('empty');
    }
    toast('ডাটা আনা যায়নি — ' + (e.message || 'নেটওয়ার্ক সমস্যা'), 'err');
  }
}

function allSubjects() {
  // এই ৭টি বিষয়ই থাকবে (+ পোস্টে অন্য কিছু থাকলে সেটাও দেখাবে)
  const list = DEFAULT_SUBJECTS.slice();
  posts.forEach(p => { if (p.subject && !list.includes(p.subject)) list.push(p.subject); });
  return list;
}

function setState(which) { // 'loading' | 'empty' | 'no-result' | 'feed'
  $('loading').classList.toggle('hidden', which !== 'loading');
  $('empty').classList.toggle('hidden', which !== 'empty');
  $('no-result').classList.toggle('hidden', which !== 'no-result');
}

/* ---------- রেন্ডার ---------- */
function renderChips() {
  const subs = allSubjects();
  const chips = [{ key: 'all', label: '📚 সব' }].concat(subs.map(s => ({ key: s, label: s })));
  $('chips').innerHTML = chips.map(c =>
    `<button class="chip${c.key === activeSubject ? ' active' : ''}" data-subject="${escapeHtml(c.key)}">${escapeHtml(c.label)}</button>`
  ).join('');
}

function filteredPosts() {
  const q = searchText.toLowerCase();
  return posts.filter(p => {
    if (activeSubject !== 'all' && p.subject !== activeSubject) return false;
    if (!q) return true;
    const hay = [p.title, p.subject, p.description]
      .concat((p.files || []).map(f => f.name))
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

function renderFeed() {
  const list = filteredPosts();
  if (!posts.length) { $('feed').innerHTML = ''; setState('empty'); return; }
  if (!list.length) { $('feed').innerHTML = ''; setState('no-result'); return; }
  setState('feed');
  $('feed').innerHTML = list.map(postCardHtml).join('');
}

function postCardHtml(p) {
  const files = Array.isArray(p.files) ? p.files : [];
  const images = files.filter(isImageFile);
  const cover = images[0];
  const coverHtml = cover
    ? `<img src="${escapeHtml(fileUrl(cover.path))}" alt="${escapeHtml(p.title)}" loading="lazy" />`
    : `<div class="cover-placeholder">📕</div>`;
  const count = files.length > 1 ? `<span class="cover-count">🖼️ +${toBn(files.length - 1)}</span>` : '';

  const chips = files.map((f, i) => {
    const icon = isImageFile(f) ? '🖼️' : '📄';
    return `<span class="file-pair">` +
      `<button class="file-chip" data-post="${p.id}" data-idx="${i}"><span>${icon}</span><span class="fname">${escapeHtml(f.name || 'ফাইল')}</span></button>` +
      `<a class="dl-btn" href="${escapeHtml(fileUrl(f.path, true))}" title="ডাউনলোড" aria-label="ডাউনলোড">⬇</a>` +
      `</span>`;
  }).join('');

  return `<article class="post-card">` +
    `<div class="post-cover">${coverHtml}${count}</div>` +
    `<div class="post-body">` +
    `<div class="post-meta"><span class="badge">${escapeHtml(p.subject || '')}</span><span class="time">${timeAgo(p.created_at)}</span></div>` +
    `<h3>${escapeHtml(p.title)}</h3>` +
    (p.description ? `<p class="post-desc">${escapeHtml(p.description)}</p>` : '') +
    `<div class="file-row">${chips}</div>` +
    `<div class="post-foot"><span class="time">📁 ${toBn(files.length)} টি ফাইল</span>` +
    (isAdmin ? `<button class="del-btn" data-del="${p.id}">🗑 মুছুন</button>` : '') +
    `</div></div></article>`;
}

/* ---------- মডাল খোলা/বন্ধ ---------- */
function openModal(id) {
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  $(id).classList.add('hidden');
  document.body.style.overflow = '';
  if (id === 'pdf-modal') $('pdf-frame').src = 'about:blank';
}

/* ---------- ছবি লাইটবক্স ---------- */
function openLightbox(images, index) {
  lbImages = images;
  lbIndex = index;
  updateLightbox(0);
  $('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lb-img').src = '';
  zoomReset();
}
function stepLightbox(dir) {
  if (!lbImages.length) return;
  lbIndex = (lbIndex + dir + lbImages.length) % lbImages.length;
  updateLightbox(dir);
}
function updateLightbox(dir) {
  const item = lbImages[lbIndex];
  if (!item) return;
  zoomReset();
  const img = $('lb-img');
  img.src = item.url;
  img.style.setProperty('--lb-x', dir > 0 ? '28px' : dir < 0 ? '-28px' : '0px');
  img.classList.remove('lb-anim');
  void img.offsetWidth; // অ্যানিমেশন আবার চালু করা
  img.classList.add('lb-anim');
  $('lb-caption').textContent = `${item.name} · ${toBn(lbIndex + 1)}/${toBn(lbImages.length)}`;
  const multi = lbImages.length > 1 ? 'visible' : 'hidden';
  $('lb-prev').style.visibility = multi;
  $('lb-next').style.visibility = multi;
}

/* ---------- PDF ভিউয়ার ---------- */
function openPdf(file) {
  $('pdf-title').textContent = file.name || 'PDF';
  const url = fileUrl(file.path);
  $('pdf-frame').src = url;
  $('pdf-open').href = url;
  $('pdf-download').href = fileUrl(file.path, true);
  openModal('pdf-modal');
}

/* ---------- App Creator (Fahim) লগইন/লগআউট ---------- */
function updateAdminUi() {
  $('fab').classList.toggle('hidden', !isAdmin);
  $('teacher-btn').classList.toggle('hidden', isAdmin);
  $('logout-btn').classList.toggle('hidden', !isAdmin);
}

/* ---------- পোস্ট মুছা ---------- */
async function deletePost(id) {
  const post = posts.find(p => p.id === id);
  if (!post) return;
  if (!confirm(`"${post.title}" মুছে ফেলবেন? এটি আর ফেরানো যাবে না।`)) return;
  try {
    const paths = (Array.isArray(post.files) ? post.files : []).map(f => f.path).filter(Boolean);
    if (paths.length && sb) await sb.storage.from(BUCKET).remove(paths);
    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) throw error;
    posts = posts.filter(p => p.id !== id);
    renderChips();
    renderFeed();
    toast('🗑 মুছে ফেলা হয়েছে', 'ok');
  } catch (e) {
    console.error(e);
    toast('মুছা যায়নি — ' + (e.message || ''), 'err');
  }
}

/* ---------- ইভেন্ট লিসেনার ---------- */
$('feed').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { deletePost(del.getAttribute('data-del')); return; }
  const chip = e.target.closest('.file-chip');
  if (!chip) return;
  const post = posts.find(p => p.id === chip.getAttribute('data-post'));
  if (!post) return;
  const files = Array.isArray(post.files) ? post.files : [];
  const file = files[Number(chip.getAttribute('data-idx'))];
  if (!file) return;
  if (isImageFile(file)) {
    const images = files.filter(isImageFile).map(f => ({ url: fileUrl(f.path), name: f.name || 'ছবি' }));
    const at = images.findIndex(im => im.url === fileUrl(file.path));
    openLightbox(images, Math.max(0, at));
  } else {
    openPdf(file);
  }
});

$('chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  activeSubject = chip.getAttribute('data-subject');
  renderChips();
  renderFeed();
});

$('search').addEventListener('input', e => {
  searchText = e.target.value.trim();
  renderFeed();
});

$('refresh-btn').addEventListener('click', () => {
  toast('🔄 রিফ্রেশ করা হচ্ছে…');
  loadPosts(true);
});

$('teacher-btn').addEventListener('click', () => {
  if (isAdmin) return;
  $('login-error').classList.add('hidden');
  $('pin-input').value = '';
  openModal('login-modal');
  setTimeout(() => $('pin-input').focus(), 60);
});

$('login-form').addEventListener('submit', e => {
  e.preventDefault();
  if ($('pin-input').value === ADMIN_PIN) {
    isAdmin = true;
    sessionStorage.setItem('c5-admin', '1');
    closeModal('login-modal');
    updateAdminUi();
    renderFeed();
    toast('👑 Fahim (App Creator) মোড চালু — এখন আপলোড করতে পারবেন', 'ok');
  } else {
    $('login-error').classList.remove('hidden');
  }
});

$('logout-btn').addEventListener('click', () => {
  isAdmin = false;
  sessionStorage.removeItem('c5-admin');
  updateAdminUi();
  renderFeed();
  toast('লগআউট হয়েছে');
});

$('lb-close').addEventListener('click', closeLightbox);
$('lb-prev').addEventListener('click', () => stepLightbox(-1));
$('lb-next').addEventListener('click', () => stepLightbox(1));
$('lightbox').addEventListener('click', e => {
  if (e.target === $('lightbox')) closeLightbox();
});

/* ---------- মোবাইলে সোয়াইপ — আঙুল টেনে ছবি বদলানো ---------- */
let swipeStartX = 0;
let swipeStartY = 0;
$('lightbox').addEventListener('touchstart', e => {
  swipeStartX = e.changedTouches[0].clientX;
  swipeStartY = e.changedTouches[0].clientY;
}, { passive: true });
$('lightbox').addEventListener('touchend', e => {
  if (zoom.s > 1.01 || moved >= 12) return; // জুম করা অবস্থায় সোয়াইপে ছবি বদলাবে না
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0) stepLightbox(1);  // বাঁ দিকে টানলে → পরের ছবি
    else stepLightbox(-1);        // ডান দিকে টানলে → আগের ছবি
  }
}, { passive: true });

/* ---------- ছবি জুম — পিঞ্চ, ডাবল ট্যাপ/ক্লিক, মাউস হুইল, ড্র্যাগ ---------- */
const zoom = { s: 1, tx: 0, ty: 0 };
const lbImg = $('lb-img');

function zoomApply(smooth) {
  lbImg.style.transition = smooth ? 'transform .18s ease' : 'none';
  lbImg.style.transform = zoom.s > 1.001 ? `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})` : '';
  lbImg.classList.toggle('zoomed', zoom.s > 1.001);
}
function zoomReset() {
  zoom.s = 1; zoom.tx = 0; zoom.ty = 0;
  zoomApply(false);
}
function zoomClamp() {
  if (zoom.s <= 1.001) { zoom.tx = 0; zoom.ty = 0; return; }
  const mx = (zoom.s - 1) * lbImg.offsetWidth / 2;
  const my = (zoom.s - 1) * lbImg.offsetHeight / 2;
  zoom.tx = Math.max(-mx, Math.min(mx, zoom.tx));
  zoom.ty = Math.max(-my, Math.min(my, zoom.ty));
}
function zoomTo(ns, qx, qy, smooth) {
  ns = Math.min(4, Math.max(1, ns));
  if (Math.abs(ns - zoom.s) < .001) { zoomClamp(); zoomApply(smooth); return; }
  zoom.tx = qx - (qx - zoom.tx) * (ns / zoom.s);
  zoom.ty = qy - (qy - zoom.ty) * (ns / zoom.s);
  zoom.s = ns;
  zoomClamp();
  zoomApply(smooth);
}
const lbFocal = e => ({ x: e.clientX - innerWidth / 2, y: e.clientY - innerHeight / 2 });

// মাউস হুইল = জুম (ডেস্কটপ)
$('lightbox').addEventListener('wheel', e => {
  e.preventDefault();
  const f = lbFocal(e);
  zoomTo(zoom.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), f.x, f.y, true);
}, { passive: false });

// ডাবল ক্লিক = জুম টগল (ডেস্কটপ)
$('lightbox').addEventListener('dblclick', e => {
  const f = lbFocal(e);
  if (zoom.s > 1.01) zoomReset(); else zoomTo(2.5, f.x, f.y, true);
});

// মাউস ড্র্যাগ = জুম করা ছবি ঘোরানো (ডেস্কটপ)
let dragging = false, dragX = 0, dragY = 0;
$('lightbox').addEventListener('mousedown', e => {
  if (zoom.s <= 1.01 || e.button !== 0) return;
  dragging = true; dragX = e.clientX; dragY = e.clientY;
  lbImg.classList.add('panning');
  e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  zoom.tx += e.clientX - dragX;
  zoom.ty += e.clientY - dragY;
  dragX = e.clientX; dragY = e.clientY;
  zoomClamp(); zoomApply(false);
});
window.addEventListener('mouseup', () => { dragging = false; lbImg.classList.remove('panning'); });

// টাচ: পিঞ্চ জুম + এক আঙুলে প্যান + ডাবল ট্যাপ জুম (মোবাইল)
let pinch = null, lastTap = 0, tapStart = 0, moved = 0;
$('lightbox').addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinch = {
      d0: Math.hypot(dx, dy) || 1,
      s0: zoom.s,
      qx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - innerWidth / 2,
      qy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - innerHeight / 2,
      tx0: zoom.tx, ty0: zoom.ty
    };
  } else if (e.touches.length === 1) {
    pinch = null;
    tapStart = Date.now(); moved = 0;
    lbImg.dataset.lastX = e.touches[0].clientX;
    lbImg.dataset.lastY = e.touches[0].clientY;
  }
}, { passive: true });

$('lightbox').addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const ns = Math.min(4, Math.max(1, pinch.s0 * Math.hypot(dx, dy) / pinch.d0));
    zoom.tx = pinch.qx - (pinch.qx - pinch.tx0) * (ns / pinch.s0);
    zoom.ty = pinch.qy - (pinch.qy - pinch.ty0) * (ns / pinch.s0);
    zoom.s = ns;
    zoomClamp(); zoomApply(false);
    moved = 999;
  } else if (e.touches.length === 1 && zoom.s > 1.01) {
    e.preventDefault();
    const t = e.touches[0];
    zoom.tx += t.clientX - Number(lbImg.dataset.lastX);
    zoom.ty += t.clientY - Number(lbImg.dataset.lastY);
    lbImg.dataset.lastX = t.clientX;
    lbImg.dataset.lastY = t.clientY;
    zoomClamp(); zoomApply(false);
    moved = 999;
  }
}, { passive: false });

$('lightbox').addEventListener('touchend', e => {
  if (pinch && e.touches.length < 2) pinch = null;
  const dur = Date.now() - tapStart;
  if (dur < 300 && moved < 12 && e.changedTouches.length === 1) {
    const now = Date.now();
    if (now - lastTap < 320) {
      const t = e.changedTouches[0];
      const f = { x: t.clientX - innerWidth / 2, y: t.clientY - innerHeight / 2 };
      if (zoom.s > 1.01) zoomReset(); else zoomTo(2.5, f.x, f.y, true);
      lastTap = 0;
    } else lastTap = now;
  }
}, { passive: true });

document.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => closeModal(el.getAttribute('data-close')))
);

document.addEventListener('keydown', e => {
  if (!$('lightbox').classList.contains('hidden')) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  } else if (e.key === 'Escape') {
    ['login-modal', 'upload-modal', 'pdf-modal'].forEach(id => {
      if (!$(id).classList.contains('hidden')) closeModal(id);
    });
  }
});

/* ---------- আপলোড ---------- */
async function compressImage(file) {
  try {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400 * 1024) return file;
    const bmp = await createImageBitmap(file);
    const MAXDIM = 1600;
    if (bmp.width <= MAXDIM && bmp.height <= MAXDIM) return file;
    const scale = Math.min(MAXDIM / bmp.width, MAXDIM / bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    return file; // কম্প্রেস ব্যর্থ হলে আসল ফাইলই থাকবে
  }
}

function openUploadModal() {
  $('up-subject').innerHTML = DEFAULT_SUBJECTS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  $('upload-form').reset();
  pendingFiles.forEach(it => it.preview && URL.revokeObjectURL(it.preview));
  pendingFiles = [];
  renderFileList();
  $('upload-progress').classList.add('hidden');
  openModal('upload-modal');
}

$('pick-btn').addEventListener('click', () => $('up-files').click());
$('up-files').addEventListener('change', async e => {
  await addFiles(e.target.files);
  e.target.value = '';
});

async function addFiles(fileList) {
  for (const raw of Array.from(fileList || [])) {
    if (!isImageFile(raw) && !isPdfFile(raw)) {
      toast('শুধু ছবি বা PDF দেওয়া যাবে — ' + (raw.name || ''), 'err');
      continue;
    }
    if (raw.size > MAX_MB * 1024 * 1024) {
      toast(`"${raw.name}" অনেক বড় (সর্বোচ্চ ${toBn(MAX_MB)}MB)`, 'err');
      continue;
    }
    if (pendingFiles.length >= 20) {
      toast('একবারে সর্বোচ্চ ২০টি ফাইল', 'err');
      break;
    }
    const file = isImageFile(raw) ? await compressImage(raw) : raw;
    pendingFiles.push({
      id: Math.random().toString(36).slice(2),
      file,
      preview: isImageFile(file) ? URL.createObjectURL(file) : null
    });
  }
  renderFileList();
}

function renderFileList() {
  $('file-list').innerHTML = pendingFiles.map(it =>
    `<div class="file-item">` +
    (it.preview ? `<img class="file-thumb" src="${it.preview}" alt="" />` : `<div class="file-thumb">📄</div>`) +
    `<div class="file-info"><div class="n">${escapeHtml(it.file.name)}</div><div class="s">${bnBytes(it.file.size)}</div></div>` +
    `<button type="button" class="remove-file" data-rm="${it.id}" title="বাদ দিন">✕</button>` +
    `</div>`
  ).join('');
}

$('file-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-rm]');
  if (!btn) return;
  const id = btn.getAttribute('data-rm');
  const it = pendingFiles.find(x => x.id === id);
  if (it && it.preview) URL.revokeObjectURL(it.preview);
  pendingFiles = pendingFiles.filter(x => x.id !== id);
  renderFileList();
});

$('upload-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (uploading) return;
  const subject = $('up-subject').value.trim();
  const title = $('up-title').value.trim();
  const desc = $('up-desc').value.trim();
  if (!subject) { toast('বিষয়ের নাম লিখুন', 'err'); return; }
  if (!title) { toast('শিরোনাম লিখুন', 'err'); return; }
  if (!pendingFiles.length) { toast('অন্তত একটি ছবি বা PDF বাছুন', 'err'); return; }
  await doUpload({ subject, title, desc });
});

async function doUpload(data) {
  uploading = true;
  const btn = $('upload-submit');
  const prog = $('upload-progress');
  btn.disabled = true;
  prog.classList.remove('hidden');
  try {
    const metas = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const item = pendingFiles[i];
      prog.textContent = `⬆️ আপলোড হচ্ছে ${toBn(i + 1)}/${toBn(pendingFiles.length)} — ${item.file.name}`;
      const safe = (item.file.name || 'file').replace(/[\\/:*?"<>|]+/g, '_');
      const path = `posts/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, item.file, {
        contentType: item.file.type || 'application/octet-stream',
        upsert: false
      });
      if (error) throw error;
      metas.push({ name: item.file.name, path, type: item.file.type || '', size: item.file.size });
    }
    prog.textContent = '💾 সেভ হচ্ছে…';
    const { error: insErr } = await sb.from(TABLE).insert({
      title: data.title,
      subject: data.subject,
      description: data.desc,
      files: metas
    });
    if (insErr) throw insErr;
    pendingFiles.forEach(it => it.preview && URL.revokeObjectURL(it.preview));
    pendingFiles = [];
    activeSubject = 'all';
    searchText = '';
    $('search').value = '';
    closeModal('upload-modal');
    toast('✅ আপলোড সফল! সবাই এখনই দেখতে পাবে', 'ok');
    await loadPosts(true);
  } catch (e) {
    console.error(e);
    toast('আপলোড ব্যর্থ — ' + (e.message || ''), 'err');
  } finally {
    uploading = false;
    btn.disabled = false;
    prog.classList.add('hidden');
  }
}

/* ---------- চালু ---------- */
function init() {
  $('year').textContent = toBn(new Date().getFullYear());
  const creatorLink = $('creator-link');
  if (CREATOR_FB) creatorLink.href = CREATOR_FB;
  else creatorLink.removeAttribute('href');
  updateAdminUi();
  $('fab').addEventListener('click', openUploadModal);
  loadPosts();

  // রিয়েলটাইম — নতুন পোস্ট সাথে সাথে সবার স্ক্রিনে (SQL-এ চালু থাকলে)
  if (sb && typeof sb.channel === 'function') {
    try {
      sb.channel('c5-posts')
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => loadPosts(true))
        .subscribe();
    } catch (e) { /* রিয়েলটাইম না চললেও অ্যাপ কাজ করবে */ }
  }

  // PWA service worker
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);




