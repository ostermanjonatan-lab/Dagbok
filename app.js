'use strict';

const STORE_KEY = 'dagbok.v1';
const POS_KEY = 'dagbok.plats';

const $ = (id) => document.getElementById(id);

const editor = Paper.createEditor($('f-text'), $('fmt'), () => scheduleSave());
const moodButtons = [...$('f-mood').querySelectorAll('button')];

let entries = normalizeAll(load());
let current = todayKey();
let saveTimer = null;
let photos = [];        // bilderna för dagen som visas

/* Lagring */

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

// Gör om ett inlägg till dagens format. Äldre inlägg hade två textfält.
function normalize(e) {
  const text = typeof e.text === 'string'
    ? e.text
    : [e.highlight, e.notes].filter(Boolean).map(String).join('\n\n');
  const w = e.weather;
  return {
    text,
    mood: Number.isInteger(e.mood) && e.mood >= 1 && e.mood <= 5 ? e.mood : null,
    weather: w && (typeof w.code === 'number' || typeof w.temp === 'number')
      ? {
        code: typeof w.code === 'number' ? w.code : null,
        temp: typeof w.temp === 'number' ? w.temp : null,
        time: typeof w.time === 'string' ? w.time : null,
      }
      : null,
    photos: Array.isArray(e.photos) ? e.photos.filter((id) => /^[A-Za-z0-9_-]{8,64}$/.test(id)) : [],
    updated: typeof e.updated === 'string' ? e.updated : new Date().toISOString(),
  };
}

function normalizeAll(data) {
  const out = {};
  for (const [k, e] of Object.entries(data)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && e && typeof e === 'object') out[k] = normalize(e);
  }
  return out;
}

// Be webbläsaren att inte rensa datan när det blir ont om utrymme.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

/* Datum */

function pad(n) { return String(n).padStart(2, '0'); }

function keyOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayKey() { return keyOf(new Date()); }

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftKey(key, days) {
  const d = parseKey(key);
  d.setDate(d.getDate() + days);
  return keyOf(d);
}

const dateFmt = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const monthFmt = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', hour12: false });

function fmtDate(key) { return dateFmt.format(parseKey(key)); }

/* Väder från Open-Meteo, utan konto eller nyckel */

const WEATHER_TEXT = {
  0: 'Klart', 1: 'Mest klart', 2: 'Halvklart', 3: 'Mulet',
  45: 'Dimma', 48: 'Dimma med rimfrost',
  51: 'Lätt duggregn', 53: 'Duggregn', 55: 'Kraftigt duggregn',
  56: 'Underkylt duggregn', 57: 'Underkylt duggregn',
  61: 'Lätt regn', 63: 'Regn', 65: 'Kraftigt regn',
  66: 'Underkylt regn', 67: 'Underkylt regn',
  71: 'Lätt snöfall', 73: 'Snöfall', 75: 'Kraftigt snöfall', 77: 'Snökorn',
  80: 'Lätta regnskurar', 81: 'Regnskurar', 82: 'Kraftiga regnskurar',
  85: 'Snöbyar', 86: 'Kraftiga snöbyar',
  95: 'Åska', 96: 'Åska med hagel', 99: 'Åska med hagel',
  // Egen kod, inte en av Open-Meteos väderkoder
  1000: 'Storm',
};

// Väder som valts för hand i artifact-versionen saknar klockslag och kan sakna kod eller temperatur.
function fmtWeather(w) {
  const parts = [];
  if (w.code != null) parts.push(w.code === 0 ? 'Sol' : WEATHER_TEXT[w.code] || 'Okänt väder');
  if (w.temp != null) parts.push(`${String(Math.round(w.temp)).replace('-', '\u2212')}\u00a0°C`);
  return parts.join(', ') + (w.time ? ` kl ${w.time}` : '');
}

function getPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && Date.now() - saved.at < 60 * 60 * 1000) return Promise.resolve(saved);
  } catch {}
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('ingen plats')); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const pos = {
        lat: Math.round(p.coords.latitude * 100) / 100,
        lon: Math.round(p.coords.longitude * 100) / 100,
        at: Date.now(),
      };
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
      resolve(pos);
    }, reject, { timeout: 15000, maximumAge: 30 * 60 * 1000 });
  });
}

// Vädret kl 12 den dagen, eller just nu om man skriver dagens inlägg före kl 12.
function wantsNow(key) {
  return key === todayKey() && new Date().getHours() < 12;
}

// SMHI kallar medelvind från 24,5 m/s för storm. Då sparas Storm i stället för vädret.
function stormOr(code, wind) {
  return typeof wind === 'number' && wind >= 24.5 ? 1000 : code;
}

async function fetchWeather(key) {
  const { lat, lon } = await getPosition();
  const base = `latitude=${lat}&longitude=${lon}&timezone=auto`;
  if (wantsNow(key)) {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${base}&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=ms`);
    if (!res.ok) throw new Error('väder');
    const data = await res.json();
    return {
      code: stormOr(data.current.weather_code, data.current.wind_speed_10m),
      temp: data.current.temperature_2m,
      time: timeFmt.format(new Date()),
    };
  }
  // Prognos-API:t har de senaste månaderna, arkivet allt äldre.
  const old = (Date.now() - parseKey(key).getTime()) / 864e5 > 80;
  const host = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const res = await fetch(`${host}?${base}&start_date=${key}&end_date=${key}&hourly=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=ms`);
  if (!res.ok) throw new Error('väder');
  const data = await res.json();
  const i = data.hourly.time.indexOf(`${key}T12:00`);
  if (i === -1 || data.hourly.temperature_2m[i] == null) throw new Error('väder');
  return {
    code: stormOr(data.hourly.weather_code[i], data.hourly.wind_speed_10m[i]),
    temp: data.hourly.temperature_2m[i],
    time: '12:00',
  };
}

const weatherBusy = new Set();

async function updateWeather(key) {
  const e = entries[key];
  if (!e || weatherBusy.has(key) || !settings.weather) return;
  // Före kl 12 uppdateras vädret vid varje sparning, högst var 15:e minut.
  // Annars hämtas 12-vädret en gång.
  // Väder som valts för hand skrivs inte över
  if (e.weather && !e.weather.time) return;
  if (e.weather && !wantsNow(key) && e.weather.time === '12:00') return;
  if (wantsNow(key) && e.weatherAt && Date.now() - e.weatherAt < 15 * 60 * 1000) return;

  weatherBusy.add(key);
  try {
    const w = await fetchWeather(key);
    if (!entries[key]) return;
    entries[key].weather = w;
    if (wantsNow(key)) entries[key].weatherAt = Date.now();
    persist();
    if (key === current) showWeather(entries[key]);
  } catch (err) {
    if (key === current && !entries[key]?.weather) {
      $('weather').textContent = err && err.code === 1
        ? 'Tillåt plats för att spara vädret.'
        : 'Vädret kunde inte hämtas.';
    }
  } finally {
    weatherBusy.delete(key);
  }
}

function showWeather(e) {
  $('weather').textContent = e && e.weather ? fmtWeather(e.weather) : '';
}

/* Inställningar */

const SETTINGS_KEY = 'dagbok.installningar';
const settings = { memories: true, weather: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function renderSettings() {
  $('set-memories').checked = settings.memories;
  if ($('set-weather')) $('set-weather').checked = settings.weather;
  const keys = Object.keys(entries).sort();
  const pics = keys.reduce((n, k) => n + entries[k].photos.length, 0);
  $('stats').textContent = keys.length
    ? `${keys.length} ${keys.length === 1 ? 'dag' : 'dagar'} och ${pics} ${pics === 1 ? 'bild' : 'bilder'}, sedan ${fmtDate(keys[0])}.`
    : 'Inget skrivet ännu.';
  $('wipe').hidden = !keys.length;
  $('wipe-confirm').hidden = true;
}

$('set-memories').addEventListener('change', (ev) => {
  settings.memories = ev.target.checked;
  saveSettings();
});
if ($('set-weather')) {
  $('set-weather').addEventListener('change', (ev) => {
    settings.weather = ev.target.checked;
    saveSettings();
  });
}
$('wipe').addEventListener('click', () => {
  $('wipe').hidden = true;
  $('wipe-confirm').hidden = false;
});
$('wipe-no').addEventListener('click', () => {
  $('wipe-confirm').hidden = true;
  $('wipe').hidden = false;
});

$('wipe-yes').addEventListener('click', async () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  const keys = Object.keys(entries);
  for (const k of keys) entries[k].photos.forEach(removeAsset);
  entries = {};
  persist();
  photos = [];
  try { await photoTx('readwrite', (st) => st.clear()); } catch {}
  renderSettings();
  $('wipe-msg').textContent = `Tog bort ${keys.length} dagar.`;
});

/* Dagvy */

function readForm() {
  const checked = moodButtons.find((b) => b.getAttribute('aria-checked') === 'true');
  return {
    text: editor.get(),
    mood: checked ? Number(checked.dataset.v) : null,
    photos: photos.slice(),
  };
}

function setMood(v) {
  moodButtons.forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.v) === v));
  });
}

function showDay(key) {
  flushSave();
  const today = todayKey();
  if (key > today) key = today;
  current = key;

  const e = entries[key];
  editor.set(e ? e.text : '');
  photos = e ? e.photos.slice() : [];
  renderPhotos();
  $('photo-msg').textContent = '';
  setMood(e ? e.mood : null);
  showWeather(e);

  $('date-label').textContent = fmtDate(key);
  $('date-pick').value = key;
  $('date-pick').max = today;
  $('next').disabled = key >= today;
  $('to-today').hidden = key === today;
  $('text-label').textContent = key === today ? 'Vad som hänt idag' : 'Vad som hände';
  $('delete').hidden = !e;
  setStatus(e ? savedText(e.updated) : '');
  renderMemories(key);
  renderStreak();
}

function savedText(iso) {
  const d = new Date(iso);
  const time = timeFmt.format(d);
  return keyOf(d) === todayKey() ? `Sparad ${time}` : `Sparad ${fmtDate(keyOf(d))}, ${time}`;
}

function setStatus(text) { $('status').textContent = text; }

function save() {
  saveTimer = null;
  const data = readForm();
  if (!data.text && data.mood == null && !data.photos.length) {
    if (!entries[current]) return;
    delete entries[current];
    persist();
    showWeather(null);
    setStatus('');
    $('delete').hidden = true;
    renderStreak();
    return;
  }
  const old = entries[current];
  entries[current] = {
    ...data,
    weather: old ? old.weather : null,
    weatherAt: old ? old.weatherAt : undefined,
    updated: new Date().toISOString(),
  };
  if (persist()) {
    setStatus(savedText(entries[current].updated));
  } else {
    setStatus('Kunde inte spara. Lagringen kan vara full eller avstängd.');
  }
  $('delete').hidden = false;
  updateWeather(current);
  renderStreak();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    save();
  }
}

moodButtons.forEach((b) => {
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-checked') === 'true';
    setMood(on ? null : Number(b.dataset.v));
    scheduleSave();
  });
});

$('prev').addEventListener('click', () => go(`#/dag/${shiftKey(current, -1)}`));
$('next').addEventListener('click', () => go(`#/dag/${shiftKey(current, 1)}`));
$('to-today').addEventListener('click', () => go('#/dag'));
$('date-pick').addEventListener('change', (ev) => {
  if (ev.target.value) go(`#/dag/${ev.target.value}`);
});

$('delete').addEventListener('click', () => {
  if (!confirm(`Ta bort allt du skrivit för ${fmtDate(current)}?`)) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  (entries[current] ? entries[current].photos : []).forEach(removeAsset);
  delete entries[current];
  persist();
  showDay(current);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

/* Bilder, sparade i webbläsarens databas på den här enheten */

const photoUrls = {};
// Genomskinlig bild tills bilden har lästs in från databasen
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const photoUrl = (id) => photoUrls[id] || BLANK;

let photoDb = null;
function openPhotoDb() {
  if (!photoDb) {
    photoDb = new Promise((resolve, reject) => {
      const req = indexedDB.open('dagbok-bilder', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('bilder');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return photoDb;
}

async function photoTx(mode, fn) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bilder', mode);
    const req = fn(tx.objectStore('bilder'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const photoStore = {
  async upload(blob) {
    const id = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    await photoTx('readwrite', (st) => st.put(blob, id));
    photoUrls[id] = URL.createObjectURL(blob);
    return { id, url: photoUrls[id] };
  },
  delete(id) {
    if (photoUrls[id]) URL.revokeObjectURL(photoUrls[id]);
    delete photoUrls[id];
    return photoTx('readwrite', (st) => st.delete(id));
  },
  get: (id) => photoTx('readonly', (st) => st.get(id)),
};

// Läser in alla bilder en gång och fyller i de bilder som redan visas
async function loadPhotos() {
  const db = await openPhotoDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('bilder');
    const req = tx.objectStore('bilder').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (!photoUrls[c.key]) photoUrls[c.key] = URL.createObjectURL(c.value);
      c.continue();
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  document.querySelectorAll('img[data-id]').forEach((img) => { img.src = photoUrl(img.dataset.id); });
}

function thumbs(list, cls) {
  if (!list || !list.length) return '';
  return `<div class="${cls}">${list.map((id) =>
    `<button type="button" data-photo="${escapeHtml(id)}" aria-label="Visa bild">
      <img src="${escapeHtml(photoUrl(id))}" data-id="${escapeHtml(id)}" alt="" loading="lazy"></button>`).join('')}</div>`;
}

let uploading = 0;

function renderPhotos() {
  const box = $('photos');
  box.innerHTML = photos.map((id) =>
    `<button type="button" data-photo="${escapeHtml(id)}" aria-label="Visa bild">
      <img src="${escapeHtml(photoUrl(id))}" data-id="${escapeHtml(id)}" alt=""></button>`).join('') +
    '<div class="uploading">Sparar</div>'.repeat(uploading);
}

// Förminskar stora foton innan de laddas upp, så att de går snabbt att visa
async function shrink(file) {
  const MAX = 2048;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scale === 1 && /^image\/(jpeg|png|webp|gif)$/.test(file.type) && file.size < 3e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

async function addPhotos(files) {
  if (!files.length) return;
  const key = current;
  $('photo-msg').textContent = '';
  uploading += files.length;
  renderPhotos();
  for (const file of files) {
    try {
      const blob = await shrink(file);
      const res = await photoStore.upload(blob);
      if (key === current) {
        photos.push(res.id);
      } else {
        // Användaren har bytt dag under uppladdningen
        const e = entries[key];
        if (e) {
          e.photos.push(res.id);
          e.updated = new Date().toISOString();
          persist();
        }
      }
    } catch (err) {
      $('photo-msg').textContent = err && err.name === 'QuotaExceededError'
        ? 'Det finns inte plats för fler bilder på enheten. Ta bort några och försök igen.'
        : 'Bilden kunde inte sparas.';
    }
    uploading--;
    if (key === current) {
      renderPhotos();
      scheduleSave();
    }
  }
}

function removeAsset(id) {
  photoStore.delete(id).catch(() => {});
}

$('add-photo').addEventListener('click', () => $('photo-file').click());
$('photo-file').addEventListener('change', (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  addPhotos(files);
});

const viewer = $('photo-viewer');
let viewing = null;

function openPhoto(id, editable) {
  viewing = id;
  $('viewer-img').src = photoUrl(id);
  $('photo-delete').hidden = !editable;
  $('photo-confirm').hidden = true;
  if (viewer.showModal) viewer.showModal();
  else viewer.setAttribute('open', '');
}

function closePhoto() {
  if (viewer.close) viewer.close();
  else viewer.removeAttribute('open');
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-photo]');
  if (btn) openPhoto(btn.dataset.photo, !!btn.closest('#photos'));
});
$('viewer-close').addEventListener('click', closePhoto);
viewer.addEventListener('click', (ev) => { if (ev.target === viewer) closePhoto(); });
$('photo-delete').addEventListener('click', () => {
  $('photo-delete').hidden = true;
  $('photo-confirm').hidden = false;
});
$('photo-delete-no').addEventListener('click', () => {
  $('photo-confirm').hidden = true;
  $('photo-delete').hidden = false;
});
$('photo-delete-yes').addEventListener('click', () => {
  photos = photos.filter((id) => id !== viewing);
  removeAsset(viewing);
  renderPhotos();
  scheduleSave();
  closePhoto();
});

/* Den här dagen tidigare år */

// Inlägg från samma datum tidigare år, det senaste först
function renderMemories(key) {
  const md = key.slice(4);
  const year = Number(key.slice(0, 4));
  const keys = settings.memories
    ? Object.keys(entries).filter((k) => k.slice(4) === md && k < key).sort().reverse()
    : [];
  $('memories').hidden = !keys.length;
  $('memory-list').innerHTML = keys.map((k) => {
    const e = entries[k];
    const n = year - Number(k.slice(0, 4));
    // Rader slås ihop till ett utdrag, med punkt efter rubriker och listpunkter
    const text = Paper.mdToText(e.text).split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => (/[.!?:…]$/.test(l) ? l : l + '.')).join(' ');
    const dot = e.mood ? `<span class="dot" style="--m: var(--m${e.mood})"></span>` : '';
    const pics = e.photos.slice(0, 4).map((id) =>
      `<img src="${escapeHtml(photoUrl(id))}" data-id="${escapeHtml(id)}" alt="" loading="lazy">`).join('');
    return `<button type="button" class="memory" data-key="${k}">
      <span class="ago">${dot}För ${n} år sedan</span>
      <span class="on">${fmtDate(k)}${e.weather ? `, ${escapeHtml(fmtWeather(e.weather))}` : ''}</span>
      ${text ? `<span class="excerpt">${escapeHtml(text)}</span>` : ''}
      ${pics ? `<span class="mthumbs">${pics}</span>` : ''}
    </button>`;
  }).join('');
}

$('memory-list').addEventListener('click', (ev) => {
  const m = ev.target.closest('.memory');
  if (m) openReader(m.dataset.key);
});

/* Flöde */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderList() {
  const q = $('search').value.trim();
  const lq = q.toLowerCase();
  // Utan sökning visas månaden i kalendern, med sökning hela dagboken
  const keys = Object.keys(entries).sort().reverse().filter((k) => {
    if (!lq) return k.slice(0, 7) === calMonth;
    const e = entries[k];
    return [Paper.mdToText(e.text), fmtDate(k), e.weather ? fmtWeather(e.weather) : '']
      .some((t) => t.toLowerCase().includes(lq));
  });

  const list = $('list');
  if (!keys.length) {
    list.innerHTML = `<p class="empty">${
      q ? 'Inga dagar matchar sökningen.' : `Inget skrivet i ${monthFmt.format(parseKey(calMonth + '-01'))}.`
    }</p>`;
    return;
  }

  const today = todayKey();
  let html = '';
  let month = '';
  for (const k of keys) {
    const e = entries[k];
    const m = monthFmt.format(parseKey(k));
    if (q && m !== month) {
      month = m;
      html += `<h2 class="month">${m}</h2>`;
    }
    const dot = e.mood ? `<span class="dot" style="--m: var(--m${e.mood})" title="Humör ${e.mood}"></span>` : '';
    html += `<article class="post${k === today ? ' today' : ''}">
      <div class="post-head">
        <span class="when">${dot}${fmtDate(k)}</span>
        <a class="link open" href="#/dag/${k}">Redigera</a>
      </div>
      ${e.text ? `<div class="prose">${Paper.mdToHtml(e.text)}</div>` : ''}
      ${thumbs(e.photos, 'thumbs')}
      ${e.weather ? `<div class="meta">${escapeHtml(fmtWeather(e.weather))}</div>` : ''}
    </article>`;
  }
  list.innerHTML = html;
  if (q) list.querySelectorAll('.when, .prose, .meta').forEach((el) => Paper.highlight(el, q));
}

$('search').addEventListener('input', renderList);

/* Kalender */

const SHOW_KEY = 'dagbok.kalendervisning';
// Små väderikoner för kalendern, ritade med samma linjer som menyikonerna
const CLOUD = '<path d="M7 15h10a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.6 9.1 3 3 0 0 0 7 15z"/>';
const WEATHER_ICONS = {
  0: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  2: '<path d="M8.5 4v1.5M3.5 9H5M4.9 5.4 6 6.5M12.1 5.4 11 6.5"/><path d="M5.6 11.2A3.5 3.5 0 1 1 11.6 7.6"/><path d="M8.5 19h9a3 3 0 0 0 .3-5.98A4.3 4.3 0 0 0 9.4 13.7 2.7 2.7 0 0 0 8.5 19z"/>',
  3: '<path d="M7 18h10a4 4 0 0 0 .4-7.98A5.6 5.6 0 0 0 6.6 11.1 3.5 3.5 0 0 0 7 18z"/>',
  63: CLOUD + '<path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  73: CLOUD + '<path d="M8.5 18v2.4M7.3 19.2h2.4M12 19.2v2.4M10.8 20.4h2.4M15.5 18v2.4M14.3 19.2h2.4"/>',
  95: CLOUD + '<path d="M12.5 15.5 10.5 19h3l-2 3.5"/>',
  // Storm: vindlinjer som virvlar
  1000: '<path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h7a2 2 0 1 1-2 2"/>',
  45: '<path d="M4 9h16M6 13h12M4 17h16"/>',
};

// Samma grupper som väderknapparna: klart, halvklart, mulet, regn, snö, åska, dimma
function weatherGroup(code) {
  if (code == null) return null;
  if (code <= 1) return 0;
  if (code === 2 || code === 3) return code;
  if (code === 45 || code === 48) return 45;
  if (code === 1000) return 1000;
  if (code >= 95) return 95;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 73;
  return 63;
}

function weatherCell(w) {
  if (!w) return '';
  const g = weatherGroup(w.code);
  const icon = g != null
    ? `<svg viewBox="0 0 24 24" aria-hidden="true">${WEATHER_ICONS[g]}</svg>` : '';
  const temp = w.temp != null ? `${String(Math.round(w.temp)).replace('-', '−')}°` : '';
  return icon || temp ? `<span class="wx">${icon}${temp}</span>` : '';
}

let calMonth = todayKey().slice(0, 7);
let calSel = todayKey();

// Vad kalendern visar utöver skrivna dagar. Humör och väder kan visas samtidigt.
const calShow = { mood: false, weather: false };
try {
  const saved = localStorage.getItem(SHOW_KEY);
  if (saved == null) {
    // Från de allra första kryssrutorna
    calShow.mood = localStorage.getItem('dagbok.humorfilter') === '1';
    calShow.weather = localStorage.getItem('dagbok.vaderfilter') === '1';
  } else if (saved.startsWith('{')) {
    const v = JSON.parse(saved);
    calShow.mood = !!v.mood;
    calShow.weather = !!v.weather;
  } else {
    // Från tiden då man bara kunde välja en: '', 'mood' eller 'weather'
    calShow.mood = saved === 'mood';
    calShow.weather = saved === 'weather';
  }
} catch {}

/* Tabletterna för vad kalendern visar. Ett tryck slår på, ett till slår av. */

const pills = [...$('cal-show').querySelectorAll('.pill')];

function syncShow() {
  pills.forEach((b) => b.setAttribute('aria-pressed', String(calShow[b.dataset.value])));
}

pills.forEach((b) => b.addEventListener('click', () => {
  calShow[b.dataset.value] = !calShow[b.dataset.value];
  try { localStorage.setItem(SHOW_KEY, JSON.stringify(calShow)); } catch {}
  syncShow();
  renderCal();
}));
syncShow();

function renderCal() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const today = todayKey();
  const moods = calShow.mood;
  const weathers = calShow.weather;

  $('cal-title').textContent = monthFmt.format(first);
  $('cal-next').disabled = calMonth >= today.slice(0, 7);
  $('cal-grid').classList.toggle('moods', moods);
  $('cal-grid').classList.toggle('weathers', weathers);
  $('legend').classList.toggle('off', !moods);

  let html = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön']
    .map((d) => `<div class="wd">${d}</div>`).join('');
  // Veckan börjar på måndag
  const offset = (first.getDay() + 6) % 7;
  html += '<div></div>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const key = `${calMonth}-${pad(d)}`;
    const e = entries[key];
    const cls = ['day'];
    if (e) cls.push('has');
    if (key === today) cls.push('today');
    if (key === calSel) cls.push('sel');
    const wx = weathers && e ? weatherCell(e.weather) : '';
    if (wx) cls.push('has-wx');
    const style = e && e.mood ? ` style="--m: var(--m${e.mood})"` : '';
    let label = fmtDate(key) + (e && e.mood ? `, humör ${e.mood}` : e ? ', skrivet' : '');
    if (e && e.weather) label += `, ${fmtWeather(e.weather)}`;
    html += `<button type="button" class="${cls.join(' ')}" data-key="${key}"${style}
      aria-label="${escapeHtml(label)}"${key > today ? ' disabled' : ''}><span>${d}</span>${wx}</button>`;
  }
  $('cal-grid').innerHTML = html;
  renderList();
  renderStats();
}

// Visar dagen i ett fönster ovanpå kalendern. Man bläddrar mellan dagar man skrivit,
// med pilarna eller genom att svepa i sidled.
function writtenNeighbors(key) {
  const keys = Object.keys(entries).sort();
  let prev = null;
  let next = null;
  for (const k of keys) {
    if (k < key) prev = k;
    else if (k > key && !next) next = k;
  }
  return { prev, next };
}

function readerPane(key) {
  const e = entries[key];
  if (!e) {
    return `<div class="reader-pane" data-key="${key}">
      <p class="empty">Inget skrivet den här dagen.</p>
      <div class="reader-foot"><button type="button" class="link reader-edit" data-key="${key}">Skriv för den här dagen</button></div>
    </div>`;
  }
  const meta = [];
  if (e.mood) meta.push(`<span class="dot" style="--m: var(--m${e.mood})"></span>Humör ${e.mood}`);
  if (e.weather) meta.push(escapeHtml(fmtWeather(e.weather)));
  return `<div class="reader-pane" data-key="${key}">
    ${e.text ? `<div class="prose">${Paper.mdToHtml(e.text)}</div>` : ''}
    ${thumbs(e.photos, 'thumbs')}
    ${meta.length ? `<div class="meta">${meta.join(', ')}</div>` : ''}
    <div class="reader-foot"><button type="button" class="link reader-edit" data-key="${key}">Redigera dagen</button></div>
  </div>`;
}

let readerKey = null;

function showReaderDay(key) {
  readerKey = key;
  const { prev, next } = writtenNeighbors(key);
  const keys = [prev, key, next].filter(Boolean);
  const track = $('reader-track');
  track.innerHTML = keys.map(readerPane).join('');
  // Panelen för dagen läggs i mitten så att man kan svepa åt båda hållen
  track.scrollLeft = keys.indexOf(key) * track.clientWidth;
  $('reader-title').textContent = fmtDate(key);
  $('reader-prev').disabled = !prev;
  $('reader-next').disabled = !next;

  calSel = key;
  if (key.slice(0, 7) !== calMonth) calMonth = key.slice(0, 7);
  renderCal();
}

function openReader(key) {
  const reader = $('reader');
  if (reader.showModal) { if (!reader.open) reader.showModal(); }
  else reader.setAttribute('open', '');
  showReaderDay(key);
}

function stepReader(dir) {
  const { prev, next } = writtenNeighbors(readerKey);
  const target = dir < 0 ? prev : next;
  if (!target) return;
  const pane = $('reader-track').querySelector(`[data-key="${target}"]`);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (pane && !reduce) {
    $('reader-track').scrollTo({ left: pane.offsetLeft, behavior: 'smooth' });
  } else {
    showReaderDay(target);
  }
}

// När svepningen har stannat byts dagen om den hamnat på en annan panel
let snapTimer = null;
function onReaderScroll() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const track = $('reader-track');
    const w = track.clientWidth;
    if (!w) return;
    const pane = track.children[Math.round(track.scrollLeft / w)];
    if (pane && pane.dataset.key !== readerKey) showReaderDay(pane.dataset.key);
  }, 120);
}

function closeReader() {
  const reader = $('reader');
  if (reader.close) reader.close();
  else reader.removeAttribute('open');
}

/* Svit och statistik */

// Svit: dagar i rad med inlägg. Nuvarande räknas från idag, eller från igår
// om dagens inlägg inte är skrivet än, så att sviten inte bryts på morgonen.
function streaks() {
  const keys = Object.keys(entries).sort();
  let longest = 0;
  let longestEnd = null;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    run = prev && shiftKey(prev, 1) === k ? run + 1 : 1;
    if (run > longest) {
      longest = run;
      longestEnd = k;
    }
    prev = k;
  }
  const today = todayKey();
  let d = entries[today] ? today : shiftKey(today, -1);
  let current = 0;
  while (entries[d]) {
    current++;
    d = shiftKey(d, -1);
  }
  return { current, longest, longestEnd, todayDone: !!entries[today] };
}

const dagar = (n) => `${n} ${n === 1 ? 'dag' : 'dagar'}`;

function renderStreak() {
  const s = streaks();
  const el = $('streak');
  if (current !== todayKey() || s.current < 2) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = s.todayDone
    ? `${s.current} dagar i rad`
    : `${s.current} dagar i rad. Skriv idag för att hålla sviten.`;
}

const fmtDec = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const monthOnlyFmt = new Intl.DateTimeFormat('sv-SE', { month: 'long' });
const monthShortFmt = new Intl.DateTimeFormat('sv-SE', { month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long' });

function shiftYm(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthMoods(ym) {
  return Object.keys(entries).filter((k) => k.slice(0, 7) === ym && entries[k].mood)
    .map((k) => entries[k].mood);
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Statistiken gäller månaden eller året som kalendern visar, eller hela dagboken
const PERIOD_KEY = 'dagbok.statperiod';
let statPeriod = 'month';
try {
  const p = localStorage.getItem(PERIOD_KEY);
  if (p === 'year' || p === 'all') statPeriod = p;
} catch {}

const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5) + 1;

function periodKeys(period, ym) {
  const all = Object.keys(entries).sort();
  if (period === 'all') return all;
  if (period === 'year') return all.filter((k) => k.slice(0, 4) === ym.slice(0, 4));
  return all.filter((k) => k.slice(0, 7) === ym);
}

const moodsOf = (keys) => keys.map((k) => entries[k].mood).filter(Boolean);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function renderStats() {
  const ym = calMonth;
  const year = ym.slice(0, 4);
  const keys = periodKeys(statPeriod, ym);
  const monthName = monthFmt.format(parseKey(ym + '-01'));

  document.querySelectorAll('#stat-period .pill').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.period === statPeriod));
    b.tabIndex = b.dataset.period === statPeriod ? 0 : -1;
  });

  $('stats-body').hidden = !keys.length;
  $('stats-empty').hidden = !!keys.length;
  if (!keys.length) {
    $('stats-empty').textContent = statPeriod === 'all' ? 'Inget skrivet ännu.'
      : statPeriod === 'year' ? `Ingen statistik, inget skrivet ${year}.`
        : `Ingen statistik, inget skrivet i ${monthName}.`;
    return;
  }

  $('month-stats-title').textContent = statPeriod === 'all' ? 'Statistik för hela dagboken'
    : statPeriod === 'year' ? `Statistik för ${year}` : `Statistik för ${monthName}`;

  // Dagar som har passerat, så att en pågående period inte ser halvtom ut
  const today = todayKey();
  let passed;
  if (statPeriod === 'all') {
    passed = daysBetween(keys[0], today);
  } else if (statPeriod === 'year') {
    passed = year === today.slice(0, 4) ? daysBetween(`${year}-01-01`, today)
      : daysBetween(`${year}-01-01`, `${year}-12-31`);
  } else {
    const first = parseKey(ym + '-01');
    const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    passed = ym === today.slice(0, 7) ? Number(today.slice(8)) : total;
  }

  const facts = [['Skrivna dagar', `${keys.length} av ${passed}`]];
  const moods = moodsOf(keys);

  if (moods.length) {
    const a = avg(moods);
    let cmp = '';
    let prev = [];
    let prevName = '';
    if (statPeriod === 'month') {
      const prevYm = shiftYm(ym, -1);
      prev = monthMoods(prevYm);
      prevName = monthOnlyFmt.format(parseKey(prevYm + '-01'));
    } else if (statPeriod === 'year') {
      prevName = String(Number(year) - 1);
      prev = moodsOf(periodKeys('year', `${prevName}-01`));
    }
    if (prev.length) {
      const diff = Math.round((a - avg(prev)) * 10) / 10;
      cmp = diff > 0 ? `, upp ${fmtDec(diff)} från ${prevName}`
        : diff < 0 ? `, ner ${fmtDec(-diff)} från ${prevName}`
          : `, samma som ${prevName}`;
    }
    facts.push(['Snitthumör', `${fmtDec(a)}${cmp}`]);

    // Bästa månad för år och totalt, bara månader med minst fem dagar med humör
    if (statPeriod !== 'month') {
      const byMonth = {};
      for (const k of keys) {
        if (entries[k].mood) (byMonth[k.slice(0, 7)] = byMonth[k.slice(0, 7)] || []).push(entries[k].mood);
      }
      const best = Object.entries(byMonth).filter(([, v]) => v.length >= 5)
        .map(([m, v]) => [m, avg(v)]).sort((x, y) => y[1] - x[1])[0];
      if (best) {
        const d = parseKey(best[0] + '-01');
        const label = statPeriod === 'year' ? monthOnlyFmt.format(d) : monthFmt.format(d);
        facts.push(['Bästa månad', `${label}, ${fmtDec(best[1])}`]);
      }
    }

    // Bästa veckodag, bara veckodagar med minst två inlägg räknas
    const byDay = {};
    for (const k of keys) {
      const e = entries[k];
      if (!e.mood) continue;
      const wd = parseKey(k).getDay();
      (byDay[wd] = byDay[wd] || []).push(e.mood);
    }
    const bestDay = Object.entries(byDay).filter(([, v]) => v.length >= 2)
      .map(([wd, v]) => [Number(wd), avg(v)]).sort((x, y) => y[1] - x[1])[0];
    if (bestDay) {
      const sample = new Date(2026, 0, 4 + bestDay[0]);
      facts.push(['Bästa veckodag', `${weekdayFmt.format(sample)}, ${fmtDec(bestDay[1])}`]);
    }

  }

  const s = streaks();
  if (s.longest >= 2) {
    facts.push(['Svit', `${dagar(s.current)} nu, längsta ${dagar(s.longest)}`]);
  }

  $('facts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');

  // Fördelning av humöret, en stapel med fem delar
  const counts = [1, 2, 3, 4, 5].map((v) => moods.filter((x) => x === v).length);
  $('distr').hidden = !moods.length;
  $('distr-bar').innerHTML = counts.map((c, i) => (c
    ? `<span style="--m: var(--m${i + 1}); flex-grow: ${c}" title="Humör ${i + 1}: ${dagar(c)}">${c}</span>`
    : '')).join('');
  $('distr').setAttribute('aria-label', 'Humör: ' + counts.map((c, i) => `${c} med ${i + 1}`).join(', '));

  renderTrend();
}

// Månaderna i diagrammet: senaste tolv, årets tolv eller alla sedan första inlägget
function trendMonths() {
  if (statPeriod === 'year') {
    const y = calMonth.slice(0, 4);
    return [...Array(12)].map((_, i) => `${y}-${pad(i + 1)}`);
  }
  if (statPeriod === 'all') {
    const first = Object.keys(entries).sort()[0];
    const end = todayKey().slice(0, 7);
    const out = [];
    for (let m = first ? first.slice(0, 7) : end; m <= end; m = shiftYm(m, 1)) out.push(m);
    while (out.length < 2) out.unshift(shiftYm(out[0], -1));
    return out;
  }
  const out = [];
  for (let i = 11; i >= 0; i--) out.push(shiftYm(calMonth, -i));
  return out;
}

function renderTrend() {
  const months = trendMonths();
  $('trend-title').textContent = statPeriod === 'year' ? `Snitthumör per månad ${calMonth.slice(0, 4)}`
    : statPeriod === 'all' ? 'Snitthumör per månad' : 'Snitthumör, senaste 12 månaderna';
  const data = months.map((ym) => {
    const ms = monthMoods(ym);
    return { ym, avg: ms.length ? avg(ms) : null };
  });
  const n = data.length;
  const many = n > 12;
  const W = 340;
  const H = 128;
  const x0 = 22;
  const x1 = W - 8;
  const yOf = (v) => 12 + (5 - v) * 22; // 5 överst, 1 nederst
  const xOf = (i) => x0 + (i * (x1 - x0)) / (n - 1);
  const step = (x1 - x0) / (n - 1);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Snitthumör per månad">`;
  for (const v of [1, 3, 5]) {
    svg += `<line class="gl" x1="${x0}" x2="${x1}" y1="${yOf(v)}" y2="${yOf(v)}"/>`;
    svg += `<text class="lbl" x="${x0 - 8}" y="${yOf(v) + 3.5}" text-anchor="end">${v}</text>`;
  }
  // Linjen bryts där en månad saknar humör
  let path = '';
  let pen = false;
  data.forEach((d, i) => {
    if (d.avg == null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(d.avg).toFixed(1)}`;
    pen = true;
  });
  if (path) svg += `<path class="ln" d="${path}"/>`;
  data.forEach((d, i) => {
    const cur = d.ym === calMonth;
    if (d.avg != null) {
      const r = cur ? 5.5 : many ? 3 : 4;
      svg += `<circle class="pt${cur ? ' cur' : ''}" cx="${xOf(i)}" cy="${yOf(d.avg)}" r="${r}"/>`;
    }
    // Med många månader står bara årtalet vid januari, annars månadens förkortning
    let label = '';
    if (!many) label = monthShortFmt.format(parseKey(d.ym + '-01')).replace('.', '').slice(0, 3);
    else if (d.ym.endsWith('-01') || i === 0) label = d.ym.slice(0, 4);
    if (label) {
      svg += `<text class="lbl${cur && !many ? ' cur' : ''}" x="${xOf(i)}" y="${H - 4}" text-anchor="${many && i === 0 ? 'start' : 'middle'}">${label}</text>`;
    }
    // Träffyta större än punkten, för tryck och hovring
    svg += `<rect class="hit" x="${xOf(i) - step / 2}" y="0" width="${step}" height="${H - 14}" data-ym="${d.ym}" tabindex="0" role="button" aria-label="${monthFmt.format(parseKey(d.ym + '-01'))}${d.avg != null ? `, snitthumör ${fmtDec(d.avg)}` : ', inget humör'}"/>`;
  });
  svg += '</svg>';
  $('trend').innerHTML = svg;
  trendRead(calMonth);
}

function choosePeriod(p) {
  statPeriod = p;
  try { localStorage.setItem(PERIOD_KEY, p); } catch {}
  renderStats();
}

document.querySelectorAll('#stat-period .pill').forEach((b) => {
  b.addEventListener('click', () => choosePeriod(b.dataset.period));
});
$('stat-period').addEventListener('keydown', (ev) => {
  const order = ['month', 'year', 'all'];
  const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
  if (!step) return;
  ev.preventDefault();
  const next = order[(order.indexOf(statPeriod) + step + 3) % 3];
  choosePeriod(next);
  document.querySelector(`#stat-period [data-period="${next}"]`).focus();
});

function trendRead(ym) {
  const ms = monthMoods(ym);
  const m = monthFmt.format(parseKey(ym + '-01'));
  $('trend-read').textContent = ms.length
    ? `${m.charAt(0).toUpperCase() + m.slice(1)}: snitt ${fmtDec(avg(ms))}, ${dagar(ms.length)} med humör`
    : `${m.charAt(0).toUpperCase() + m.slice(1)}: inget humör`;
}

$('trend').addEventListener('pointerover', (ev) => {
  const r = ev.target.closest('.hit');
  if (r) trendRead(r.dataset.ym);
});
$('trend').addEventListener('pointerleave', () => trendRead(calMonth));
$('trend').addEventListener('focusin', (ev) => {
  const r = ev.target.closest('.hit');
  if (r) trendRead(r.dataset.ym);
});
// Ett tryck på en månad visar den i kalendern
$('trend').addEventListener('click', (ev) => {
  const r = ev.target.closest('.hit');
  if (!r || r.dataset.ym > todayKey().slice(0, 7)) return;
  calMonth = r.dataset.ym;
  renderCal();
});
$('trend').addEventListener('keydown', (ev) => {
  const r = ev.target.closest('.hit');
  if (r && (ev.key === 'Enter' || ev.key === ' ')) {
    ev.preventDefault();
    r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});

/* Flöde eller statistik under kalendern */

const PANEL_KEY = 'dagbok.kalenderpanel';
let calPanel = 'feed';
try { if (localStorage.getItem(PANEL_KEY) === 'stats') calPanel = 'stats'; } catch {}

function syncPanel() {
  const stats = calPanel === 'stats';
  $('seg-feed').setAttribute('aria-selected', String(!stats));
  $('seg-stats').setAttribute('aria-selected', String(stats));
  $('seg-feed').tabIndex = stats ? -1 : 0;
  $('seg-stats').tabIndex = stats ? 0 : -1;
  $('feed-panel').hidden = stats;
  $('month-stats').hidden = !stats;
}

function choosePanel(p) {
  calPanel = p;
  try { localStorage.setItem(PANEL_KEY, p); } catch {}
  syncPanel();
}

$('seg-feed').addEventListener('click', () => choosePanel('feed'));
$('seg-stats').addEventListener('click', () => choosePanel('stats'));
document.querySelector('.seg').addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  ev.preventDefault();
  choosePanel(calPanel === 'stats' ? 'feed' : 'stats');
  $(calPanel === 'stats' ? 'seg-stats' : 'seg-feed').focus();
});
syncPanel();

function shiftMonth(n) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderCal();
}

$('cal-prev').addEventListener('click', () => shiftMonth(-1));
$('cal-next').addEventListener('click', () => shiftMonth(1));
$('cal-grid').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.day');
  if (!btn || btn.disabled) return;
  openReader(btn.dataset.key);
});
$('reader-close').addEventListener('click', closeReader);
$('reader-prev').addEventListener('click', () => stepReader(-1));
$('reader-next').addEventListener('click', () => stepReader(1));
$('reader-track').addEventListener('scroll', onReaderScroll);
document.addEventListener('keydown', (ev) => {
  if (!$('reader').open) return;
  if (ev.key === 'ArrowLeft') stepReader(-1);
  if (ev.key === 'ArrowRight') stepReader(1);
});
window.addEventListener('resize', () => {
  if ($('reader').open) showReaderDay(readerKey);
});
$('reader').addEventListener('click', (ev) => {
  const edit = ev.target.closest('.reader-edit');
  if (edit) {
    closeReader();
    openDay(edit.dataset.key);
    return;
  }
  // Ett tryck utanför rutan stänger den
  if (ev.target !== $('reader')) return;
  const r = $('reader').getBoundingClientRect();
  if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closeReader();
});

function openDay(key) { go(`#/dag/${key}`); }

/* Säkerhetskopia */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Bilderna följer med i filen, annars försvinner de om telefonen byts
$('export').addEventListener('click', async () => {
  flushSave();
  const images = {};
  for (const e of Object.values(entries)) {
    for (const id of e.photos) {
      try {
        const b = await photoStore.get(id);
        if (b) images[id] = await blobToDataUrl(b);
      } catch {}
    }
  }
  const blob = new Blob([JSON.stringify({ app: 'dagbok', version: 3, entries, images }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dagbok-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let incoming;
  let images = {};
  try {
    const data = JSON.parse(await file.text());
    incoming = data.entries || data;
    if (data.images && typeof data.images === 'object') images = data.images;
    if (!incoming || typeof incoming !== 'object') throw new Error();
  } catch {
    alert('Filen gick inte att läsa. Välj en fil som exporterats från dagboken.');
    return;
  }
  let added = 0;
  let replaced = 0;
  for (const [k, e] of Object.entries(normalizeAll(incoming))) {
    const old = entries[k];
    if (!old) added++;
    else if (e.updated > old.updated) replaced++;
    else continue;
    // Bilder från filen sparas här på nytt, bilder som saknas i filen tas bort ur inlägget
    const kept = [];
    for (const id of e.photos) {
      if (photoUrls[id]) { kept.push(id); continue; }
      if (typeof images[id] !== 'string' || !images[id].startsWith('data:image/')) continue;
      try {
        const res = await photoStore.upload(await (await fetch(images[id])).blob());
        kept.push(res.id);
      } catch {}
    }
    e.photos = kept;
    entries[k] = e;
  }
  persist();
  renderList();
  alert(`Importerade ${added} nya dagar och uppdaterade ${replaced}.`);
});

/* Navigering */

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  const hash = location.hash || '#/dag';
  // Flödet ligger numera under kalendern, så gamla länkar dit öppnar kalendern
  const view = /^#\/(kalender|flode|alla)/.test(hash) ? 'cal'
    : hash.startsWith('#/installningar') ? 'set' : 'day';
  if (view !== 'day') flushSave();
  for (const v of ['day', 'cal', 'set']) {
    $(`view-${v}`).hidden = v !== view;
    $(`tab-${v}`).classList.toggle('on', v === view);
  }

  if (view === 'set') {
    renderSettings();
    $('wipe-msg').textContent = '';
  } else if (view === 'cal') {
    // Kalendern öppnar på dagen som senast visades
    calSel = current;
    calMonth = current.slice(0, 7);
    renderCal();
  } else {
    const m = hash.match(/^#\/dag\/(\d{4}-\d{2}-\d{2})$/);
    showDay(m ? m[1] : todayKey());
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
loadPhotos().catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
