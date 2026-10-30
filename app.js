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
let people = [];        // personerna som är taggade i dagen

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
    people: cleanPeople(e.people),
    media: cleanMedia(e),
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
// Kort datum som används överallt: 22 oktober, med år om det inte är i år
function shortDate(key) {
  const d = parseKey(key);
  const s = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return key.slice(0, 4) === todayKey().slice(0, 4) ? s : `${s} ${key.slice(0, 4)}`;
}
const MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

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
  return parts.join(', ');
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
    ? `${keys.length} ${keys.length === 1 ? 'dag' : 'dagar'} och ${pics} ${pics === 1 ? 'bild' : 'bilder'}, sedan ${shortDate(keys[0])}.`
    : 'Inget skrivet ännu.';
  $('wipe').hidden = !keys.length;
  $('set-lock').checked = !!lockData;
  $('change-code').hidden = !lockData;
  $('wipe-confirm').hidden = true;
  syncRemind();
  renderBackupNotice();
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
  for (const k of keys) entryAssets(entries[k]).forEach(removeAsset);
  entries = {};
  persist();
  photos = [];
  try { await photoTx('readwrite', (st) => st.clear()); } catch {}
  renderSettings();
  $('wipe-msg').textContent = `Tog bort ${keys.length} dagar.`;
});

/* Kodlås */

// Koden sparas inte, bara en hash av den. Det skyddar mot den som lånar
// telefonen, men själva dagboken krypteras inte.
const LOCK_KEY = 'dagbok.kodlas';
let lockData = null;
try { lockData = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch {}

async function hashCode(code, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const LOCK_TITLES = {
  unlock: 'Skriv din kod',
  new: 'Välj en kod med fyra siffror',
  confirm: 'Skriv koden igen',
  'verify-off': 'Skriv din kod för att stänga av låset',
  'verify-change': 'Skriv din nuvarande kod',
};
let lockMode = null;
let entered = '';
let firstCode = '';
let fails = 0;
let waitUntil = 0;
let busy = false;

function renderDots() {
  [...$('lock-dots').children].forEach((d, i) => d.classList.toggle('on', i < entered.length));
}

function setLockMode(mode) {
  lockMode = mode;
  entered = '';
  $('lock-title').textContent = LOCK_TITLES[mode];
  $('lock-cancel').hidden = mode === 'unlock';
  $('lock-help').hidden = mode !== 'unlock';
  $('lock-help-text').hidden = true;
  renderDots();
}

function showLock(mode) {
  flushSave();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  if (document.activeElement) document.activeElement.blur();
  setLockMode(mode);
  $('lock-msg').textContent = '';
  $('lock').hidden = false;
}

function hideLock() {
  $('lock').hidden = true;
  lockMode = null;
  entered = '';
}

function lockError(text) {
  $('lock-msg').textContent = text;
  const dots = $('lock-dots');
  dots.classList.remove('shake');
  void dots.offsetWidth;
  dots.classList.add('shake');
  buzz([40, 60, 40]);
  setTimeout(() => {
    dots.classList.remove('shake');
    entered = '';
    renderDots();
  }, 450);
}

async function submitCode() {
  const code = entered;
  if (lockMode === 'new') {
    firstCode = code;
    setLockMode('confirm');
    $('lock-msg').textContent = '';
    return;
  }
  if (lockMode === 'confirm') {
    if (code !== firstCode) {
      setLockMode('new');
      lockError('Koderna var olika. Välj en kod igen.');
      return;
    }
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    lockData = { salt, hash: await hashCode(code, salt) };
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(lockData)); } catch {}
    hideLock();
    renderSettings();
    return;
  }
  const ok = lockData && (await hashCode(code, lockData.salt)) === lockData.hash;
  if (!ok) {
    fails++;
    if (fails >= 5) {
      fails = 0;
      waitUntil = Date.now() + 30000;
      lockError('Fel kod fem gånger. Vänta 30 sekunder.');
    } else {
      lockError('Fel kod.');
    }
    return;
  }
  fails = 0;
  if (lockMode === 'unlock') {
    hideLock();
  } else if (lockMode === 'verify-off') {
    lockData = null;
    try { localStorage.removeItem(LOCK_KEY); } catch {}
    hideLock();
    renderSettings();
  } else if (lockMode === 'verify-change') {
    setLockMode('new');
    $('lock-msg').textContent = '';
  }
}

async function pressDigit(d) {
  if (busy || entered.length >= 4) return;
  if (Date.now() < waitUntil) {
    $('lock-msg').textContent = `Vänta ${Math.ceil((waitUntil - Date.now()) / 1000)} sekunder.`;
    return;
  }
  entered += d;
  renderDots();
  if (entered.length === 4) {
    busy = true;
    try { await submitCode(); } finally { busy = false; }
  }
}

function cancelLock() {
  if (lockMode === 'unlock') return;
  hideLock();
  renderSettings();
}

$('keypad').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.d) pressDigit(b.dataset.d);
  else if (b.id === 'lock-back') {
    entered = entered.slice(0, -1);
    renderDots();
  } else if (b.id === 'lock-cancel') cancelLock();
});
$('lock-help').addEventListener('click', () => {
  $('lock-help-text').hidden = !$('lock-help-text').hidden;
});
document.addEventListener('keydown', (ev) => {
  if ($('lock').hidden) return;
  if (/^[0-9]$/.test(ev.key)) pressDigit(ev.key);
  else if (ev.key === 'Backspace') {
    entered = entered.slice(0, -1);
    renderDots();
  } else if (ev.key === 'Escape') cancelLock();
  else return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
}, true);

$('set-lock').addEventListener('change', (ev) => {
  if (ev.target.checked) showLock('new');
  else if (lockData) showLock('verify-off');
});
$('change-code').addEventListener('click', () => showLock('verify-change'));

// Låser igen om appen har legat i bakgrunden mer än en minut
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
  } else if (lockData && $('lock').hidden && Date.now() - hiddenAt > 60000) {
    showLock('unlock');
  }
});

if (lockData) showLock('unlock');

/* Dagvy */

function readForm() {
  const checked = moodButtons.find((b) => b.getAttribute('aria-checked') === 'true');
  return {
    text: editor.get(),
    mood: checked ? Number(checked.dataset.v) : null,
    photos: photos.slice(),
    people: people.slice(),
    media: currentMedia(),
  };
}

function setMood(v) {
  moodButtons.forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.v) === v));
  });
}

// Veckodag, datum och år som separata delar så att de kan få olika storlek
const dayPartFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long' });
function setDateLabel(key) {
  const d = parseKey(key);
  $('date-label').innerHTML = `<span class="wd">${weekdayFmt.format(d)}</span>` +
    `<span class="dm">${dayPartFmt.format(d)} <span class="yr">${d.getFullYear()}</span></span>`;
  $('date-label').setAttribute('aria-label', fmtDate(key));
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
  people = e && e.people ? e.people.slice() : [];
  $('people-input').value = '';
  renderPeople();
  setDayMedia(e && e.media ? e.media : []);
  setMood(e ? e.mood : null);
  showWeather(e);

  setDateLabel(key);
  toggleDatePop(false);
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
  return keyOf(d) === todayKey() ? `Sparad ${time}` : `Sparad ${shortDate(keyOf(d))}`;
}

function setStatus(text) { $('status').textContent = text; }

function save() {
  saveTimer = null;
  const data = readForm();
  if (!data.text && data.mood == null && !data.photos.length && !data.people.length && !data.media.length) {
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
    buzz(8);
    if (!on) {
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
    }
    scheduleSave();
  });
});

function stepDay(dir) { go(`#/dag/${shiftKey(current, dir)}`); }

/* Svep åt höger eller vänster för att byta dag i dagvyn och månad i kalendern */

// area tar emot svepet, moving är det som följer fingret. canNext säger om det går
// att gå framåt, step(dir) byter med -1 eller 1. Svep som börjar i skip räknas inte.
function attachSwipe({ area, moving, skip, canNext, step }) {
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let mode = null; // null, 'start', 'x' (sidled) eller 'y' (vanlig scroll)

  function reset(animated) {
    moving.style.transition = animated && !reduce() ? 'transform .16s ease-out, opacity .16s' : 'none';
    moving.style.transform = '';
    moving.style.opacity = '';
  }

  area.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch' || (skip && ev.target.closest(skip))) return;
    sx = ev.clientX;
    sy = ev.clientY;
    dx = 0;
    mode = 'start';
  });

  area.addEventListener('pointermove', (ev) => {
    if (!mode || ev.pointerType !== 'touch') return;
    const mx = ev.clientX - sx;
    const my = ev.clientY - sy;
    if (mode === 'start') {
      if (Math.abs(mx) < 12 && Math.abs(my) < 12) return;
      // Bara tydligt sidledes rörelser byter, och inte när man markerar text
      mode = Math.abs(mx) > Math.abs(my) * 1.5 && window.getSelection().isCollapsed ? 'x' : 'y';
    }
    if (mode !== 'x') return;
    dx = mx;
    const blocked = dx < 0 && !canNext();
    moving.style.transition = 'none';
    moving.style.transform = `translateX(${dx * (blocked ? 0.12 : 0.5)}px)`;
    moving.style.opacity = String(1 - Math.min(Math.abs(dx) / 700, 0.3));
  });

  function end() {
    if (mode !== 'x') {
      mode = null;
      return;
    }
    mode = null;
    const dir = dx < 0 ? 1 : -1;
    if (Math.abs(dx) < 70 || (dir > 0 && !canNext())) {
      reset(true);
      return;
    }
    if (reduce()) {
      reset(false);
      step(dir);
      return;
    }
    // Glid ut åt samma håll som fingret, byt och glid in från andra sidan
    moving.style.transition = 'transform .14s ease-in, opacity .14s';
    moving.style.transform = `translateX(${dir > 0 ? -70 : 70}px)`;
    moving.style.opacity = '0';
    setTimeout(() => {
      step(dir);
      moving.style.transition = 'none';
      moving.style.transform = `translateX(${dir > 0 ? 70 : -70}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => reset(true)));
    }, 140);
  }

  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
}

attachSwipe({
  area: $('view-day'),
  moving: $('view-day'),
  skip: '.photos, .fmt, .date-pop, .people, .people-suggest, .film-list',
  canNext: () => current < todayKey(),
  step: (dir) => stepDay(dir),
});

$('prev').addEventListener('click', () => go(`#/dag/${shiftKey(current, -1)}`));
$('next').addEventListener('click', () => go(`#/dag/${shiftKey(current, 1)}`));
$('to-today').addEventListener('click', () => go('#/dag'));
// Egen datumväljare: en liten månadskalender under datumet
let dpMonth = '';

function renderDatePop() {
  const [y, m] = dpMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const today = todayKey();
  const t = monthFmt.format(first);
  $('dp-title').textContent = t.charAt(0).toUpperCase() + t.slice(1);
  $('dp-next').disabled = dpMonth >= today.slice(0, 7);
  let html = '<span></span>'.repeat((first.getDay() + 6) % 7);
  for (let d = 1; d <= days; d++) {
    const k = `${dpMonth}-${pad(d)}`;
    const cls = [entries[k] ? 'has' : '', k === current ? 'sel' : '', k === today ? 'today' : ''].filter(Boolean).join(' ');
    html += `<button type="button" data-key="${k}"${cls ? ` class="${cls}"` : ''}${k > today ? ' disabled' : ''} aria-label="${fmtDate(k)}">${d}</button>`;
  }
  $('dp-grid').innerHTML = html;
}

function toggleDatePop(open) {
  $('date-pop').hidden = !open;
  $('date-btn').setAttribute('aria-expanded', String(open));
  if (!open) return;
  dpMonth = current.slice(0, 7);
  renderDatePop();
}

$('date-btn').addEventListener('click', () => toggleDatePop($('date-pop').hidden));
$('dp-prev').addEventListener('click', () => { dpMonth = shiftYm(dpMonth, -1); renderDatePop(); });
$('dp-next').addEventListener('click', () => { dpMonth = shiftYm(dpMonth, 1); renderDatePop(); });
$('dp-grid').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-key]');
  if (!b || b.disabled) return;
  toggleDatePop(false);
  go(`#/dag/${b.dataset.key}`);
});
document.addEventListener('pointerdown', (ev) => {
  if (!$('date-pop').hidden && !ev.target.closest('.date')) toggleDatePop(false);
});
// Esc stänger bara väljaren, inte dagen
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || $('date-pop').hidden) return;
  ev.stopImmediatePropagation();
  toggleDatePop(false);
  $('date-btn').focus();
});

/* Sett och läst: filmer, serier och böcker med titel, betyg, recension och omslag */

const canUploadCover = () => true;
const uploadCover = (blob) => photoStore.upload(blob);

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.5l-5.5 3 1.2-6.1-4.5-4.2 6.1-.8z"/></svg>';
// Det man har sett eller läst: en film, en serie eller en bok. En dag kan ha flera.
const KINDS = { film: 'Film', serie: 'Serie', bok: 'Bok' };
const ASK = { film: 'Vilken film?', serie: 'Vilken serie?', bok: 'Vilken bok?' };
const THE = { film: 'filmen', serie: 'serien', bok: 'boken' };
const EMPTY_FILM = { kind: 'film', title: '', rating: null, cover: null, review: '', scale: 10 };
let film = { ...EMPTY_FILM };   // det som är öppet i fönstret
let media = [];                 // allt för dagen som visas
let editIdx = -1;               // var i listan det öppna hör hemma, -1 när fönstret är stängt
let coverUploading = false;

function cleanFilm(f) {
  if (!f || typeof f !== 'object') return null;
  // Körs när datan läses in, innan KINDS finns, så typerna står här
  const kind = ['film', 'serie', 'bok'].includes(f.kind) ? f.kind : 'film';
  const title = typeof f.title === 'string' ? f.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  // Betyget är 1 till 10. Det som fick betyg på den tidigare skalan 1 till 5 räknas om.
  let rating = Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 10 ? f.rating : null;
  if (rating && f.scale !== 10) rating = Math.min(10, rating * 2);
  const cover = typeof f.cover === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(f.cover) ? f.cover : null;
  const review = typeof f.review === 'string' ? f.review.trim().slice(0, 4000) : '';
  return title || rating || cover || review ? { kind, title, rating, cover, review, scale: 10 } : null;
}

// Äldre inlägg hade bara en film
function cleanMedia(e) {
  const list = Array.isArray(e.media) ? e.media : e.film ? [e.film] : [];
  return list.map(cleanFilm).filter(Boolean).slice(0, 20);
}

// Alla bilder som hör till ett inlägg: dagens bilder och omslagen
function entryAssets(e) {
  return [...e.photos, ...(e.media || []).map((m) => m.cover).filter(Boolean)];
}

// Dagens lista, med det som är öppet i fönstret
function currentMedia() {
  const list = media.slice();
  if (editIdx >= 0) {
    const c = cleanFilm(film);
    if (c) list[editIdx] = c;
    else list.splice(editIdx, 1);
  }
  return list.filter(Boolean);
}

// Betyget att visa, en stjärna och siffran
function starsHtml(rating) {
  return `<span class="stars" aria-label="Betyg ${rating} av 10"><span class="on">${STAR}</span>${rating}/10</span>`;
}

function renderFilmCover() {
  const box = $('film-cover');
  box.classList.toggle('has', !!film.cover);
  box.innerHTML = film.cover
    ? `<img src="${escapeHtml(photoUrl(film.cover))}" data-id="${escapeHtml(film.cover)}" alt="">`
    : `<span>${coverUploading ? 'Sparar' : 'Lägg till omslag'}</span>`;
  box.hidden = !film.cover && !canUploadCover();
  box.setAttribute('aria-label', film.cover ? 'Byt omslag' : 'Lägg till omslag');
}

function renderFilmRating() {
  $('rw-track').querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-selected', String(Number(b.dataset.r) === (film.rating || 0)));
  });
}


// Hjulet: siffran i mitten är betyget, längst till vänster är inget betyg
const RW_ITEM = () => $('rw-track').firstElementChild.offsetWidth;
function wheelTo(n, smooth) {
  $('rw-track').scrollTo({ left: n * RW_ITEM(), behavior: smooth ? 'smooth' : 'instant' });
}
let wheelTimer = 0;
function wheelSettled() {
  const n = Math.max(0, Math.min(10, Math.round($('rw-track').scrollLeft / RW_ITEM())));
  if ((film.rating || 0) === n) return;
  film.rating = n || null;
  renderFilmRating();
  syncFilmClear();
  buzz(5);
  scheduleSave();
}

function syncFilmClear() {
  $('film-clear').hidden = !(film.title.trim() || film.rating || film.cover || film.review.trim());
}

function renderKind() {
  $('film-kind').querySelectorAll('[data-kind]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.kind === film.kind));
  });
  $('film-title').placeholder = ASK[film.kind];
  $('film-clear').textContent = `Ta bort ${THE[film.kind]}`;
}

// I dagen syns en rad för varje film, serie eller bok, och knappen för att lägga till
function renderMediaList() {
  $('film-list').innerHTML = currentMedia().map((f, i) => `<button type="button" class="film-summary" data-i="${i}"
    aria-label="${KINDS[f.kind]}: ${escapeHtml(f.title || 'utan titel')}${f.rating ? `, betyg ${f.rating} av 10` : ''}. Ändra">
    ${f.cover ? `<img src="${escapeHtml(photoUrl(f.cover))}" data-id="${escapeHtml(f.cover)}" alt="">` : ''}
    <span class="fs-text"><span class="fs-kind">${KINDS[f.kind]}</span><span class="fs-title">${escapeHtml(f.title || 'Utan titel')}</span>${
      f.rating ? starsHtml(f.rating) : ''}</span></button>`).join('');
}

function setDayMedia(list) {
  media = list.slice();
  editIdx = -1;
  renderMediaList();
}

function setFilmForm(f) {
  film = f ? { ...EMPTY_FILM, ...f } : { ...EMPTY_FILM };
  $('film-title').value = film.title;
  $('film-review').value = film.review;
  renderKind();
  renderFilmCover();
  renderFilmRating();
  syncFilmClear();
}

// Fyll i i ett eget fönster. Allt sparas medan man ändrar, Klar stänger bara.
const filmDialog = $('film-dialog');
function openFilm(i) {
  editIdx = i;
  setFilmForm(i < media.length ? media[i] : null);
  if (filmDialog.showModal) filmDialog.showModal();
  else filmDialog.setAttribute('open', '');
  // Hjulet står på betyget när fönstret öppnas
  wheelTo(film.rating || 0, false);
}
function closeFilm() {
  if (filmDialog.close) filmDialog.close();
  else filmDialog.removeAttribute('open');
}
$('film-add').addEventListener('click', () => openFilm(media.length));
$('film-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-i]');
  if (b) openFilmView(current, Number(b.dataset.i), currentMedia()[Number(b.dataset.i)]);
});
$('film-kind').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-kind]');
  if (!b) return;
  film.kind = b.dataset.kind;
  renderKind();
  scheduleSave();
});
$('film-done').addEventListener('click', closeFilm);
$('film-close').addEventListener('click', closeFilm);
filmDialog.addEventListener('close', () => {
  media = currentMedia();
  editIdx = -1;
  flushSave();
  renderMediaList();
});
filmDialog.addEventListener('click', (ev) => { if (ev.target === filmDialog) closeFilm(); });

$('rw-track').innerHTML = [...Array(11)].map((_, i) =>
  `<button type="button" role="option" data-r="${i}" aria-label="${i ? `${i} av 10` : 'Inget betyg'}">${i || '–'}</button>`).join('');
$('rw-track').addEventListener('scroll', () => {
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(wheelSettled, 120);
}, { passive: true });
// Ett tryck på en siffra rullar dit
$('rw-track').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-r]');
  if (b) wheelTo(Number(b.dataset.r), true);
});
$('rw-track').addEventListener('keydown', (ev) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
  if (!step) return;
  ev.preventDefault();
  wheelTo(Math.max(0, Math.min(10, (film.rating || 0) + step)), true);
});
$('film-review').addEventListener('input', (ev) => {
  film.review = ev.target.value;
  syncFilmClear();
  scheduleSave();
});
$('film-title').addEventListener('input', (ev) => {
  film.title = ev.target.value;
  syncFilmClear();
  scheduleSave();
});
$('film-title').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.target.blur();
  }
});
$('film-cover').addEventListener('click', () => {
  if (canUploadCover() && !coverUploading) $('film-file').click();
});
$('film-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const key = current;
  coverUploading = true;
  renderFilmCover();
  try {
    const res = await uploadCover(await shrink(file));
    if (key === current) {
      const old = film.cover;
      film.cover = res.id;
      if (old) removeAsset(old);
      scheduleSave();
    } else {
      removeAsset(res.id);
    }
  } catch {
    $('photo-msg').textContent = 'Omslaget kunde inte sparas.';
  }
  coverUploading = false;
  renderFilmCover();
  syncFilmClear();
});
$('film-clear').addEventListener('click', () => {
  if (film.cover) removeAsset(film.cover);
  film = { ...EMPTY_FILM, kind: film.kind };
  scheduleSave();
  closeFilm();
});

/* Personer som taggas i dagen, separat från texten */

function cleanName(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 40);
}
function cleanPeople(list) {
  const out = [];
  for (const n of Array.isArray(list) ? list : []) {
    const c = cleanName(n);
    if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out.slice(0, 30);
}
// Sara, Erik och Anna
function joinNames(list) {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} och ${list[list.length - 1]}` : list[0] || '';
}

// Alla namn i dagboken, de vanligaste först
function knownPeople() {
  const count = {};
  for (const e of Object.values(entries)) {
    for (const n of e.people || []) count[n] = (count[n] || 0) + 1;
  }
  return Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b, 'sv'));
}

function renderPeople() {
  $('people-list').innerHTML = people.map((n, i) =>
    `<span class="person">${escapeHtml(n)}<button type="button" data-i="${i}" aria-label="Ta bort ${escapeHtml(n)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></span>`).join('');
}

function renderPeopleSuggest() {
  const input = $('people-input');
  const q = input.value.trim().toLowerCase();
  const list = document.activeElement === input
    ? knownPeople().filter((n) => n.toLowerCase().startsWith(q)
      && !people.some((p) => p.toLowerCase() === n.toLowerCase())).slice(0, 6)
    : [];
  $('people-suggest').hidden = !list.length;
  $('people-suggest').innerHTML = list.map((n) =>
    `<button type="button" class="pill" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('');
}

function addPerson(raw) {
  const name = cleanName(raw);
  $('people-input').value = '';
  if (name && !people.some((p) => p.toLowerCase() === name.toLowerCase())) {
    // Samma stavning som tidigare om namnet redan finns i dagboken
    people.push(knownPeople().find((n) => n.toLowerCase() === name.toLowerCase()) || name);
    renderPeople();
    scheduleSave();
  }
  renderPeopleSuggest();
}

$('people-input').addEventListener('keydown', (ev) => {
  const input = ev.target;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    addPerson(input.value);
  } else if (ev.key === 'Backspace' && !input.value && people.length) {
    people.pop();
    renderPeople();
    renderPeopleSuggest();
    scheduleSave();
  }
});
$('people-input').addEventListener('input', (ev) => {
  // Komma lägger till namnet, som Enter
  const parts = ev.target.value.split(',');
  if (parts.length > 1) {
    parts.slice(0, -1).forEach(addPerson);
    ev.target.value = parts[parts.length - 1].trimStart();
  }
  renderPeopleSuggest();
});
$('people-input').addEventListener('focus', renderPeopleSuggest);
$('people-input').addEventListener('blur', () => {
  setTimeout(() => {
    if ($('people-input').value.trim()) addPerson($('people-input').value);
    renderPeopleSuggest();
  }, 0);
});
// Ett tryck på ett förslag ska inte ta fokus från fältet
$('people-suggest').addEventListener('pointerdown', (ev) => ev.preventDefault());
$('people-suggest').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-name]');
  if (b) addPerson(b.dataset.name);
});
$('people-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-i]');
  if (!b) return;
  people.splice(Number(b.dataset.i), 1);
  renderPeople();
  scheduleSave();
});
$('people').addEventListener('click', (ev) => {
  if (ev.target === $('people') || ev.target === $('people-list')) $('people-input').focus();
});

/* Kort meddelande längst ner, med en knapp för att ångra */
let toastTimer = 0;
let toastDone = null;
function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  const done = toastDone;
  toastDone = null;
  if (done) done();
}
function showToast(text, action, onAction, onDone) {
  hideToast();
  $('toast-text').textContent = text;
  $('toast-action').textContent = action;
  $('toast-action').onclick = () => {
    toastDone = null;
    hideToast();
    onAction();
  };
  toastDone = onDone || null;
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, 6000);
}

// Lätt vibration där telefonen stöder det. Safari gör det inte.
function buzz(ms = 10) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

/* Daglig påminnelse som en återkommande händelse i telefonens kalender */
const REMIND_KEY = 'dagbok.paminnelse';
let remindAt = '21:00';
try { remindAt = localStorage.getItem(REMIND_KEY) || '21:00'; } catch {}

// Tider varje halvtimme mellan 06:00 och 23:30
const REMIND_TIMES = [...Array(36)].map((_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
if (!REMIND_TIMES.includes(remindAt)) remindAt = '21:00';

function syncRemind() {
  const i = REMIND_TIMES.indexOf(remindAt);
  $('remind-label').textContent = remindAt;
  $('remind-earlier').disabled = i === 0;
  $('remind-later').disabled = i === REMIND_TIMES.length - 1;
}
function stepRemind(n) {
  const i = Math.min(REMIND_TIMES.length - 1, Math.max(0, REMIND_TIMES.indexOf(remindAt) + n));
  remindAt = REMIND_TIMES[i];
  try { localStorage.setItem(REMIND_KEY, remindAt); } catch {}
  syncRemind();
}
$('remind-earlier').addEventListener('click', () => stepRemind(-1));
$('remind-later').addEventListener('click', () => stepRemind(1));

function reminderIcs(url) {
  const now = new Date();
  const [h, m] = remindAt.split(':').map(Number);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (start <= now) start.setDate(start.getDate() + 1);
  const p2 = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daysake//Daysake//SV', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:daysake-paminnelse-${stamp}@daysake`, `DTSTAMP:${stamp}`,
    `DTSTART:${local(start)}`, 'DURATION:PT5M', 'RRULE:FREQ=DAILY', 'SUMMARY:Skriv i Daysake',
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Skriv i Daysake', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
syncRemind();

$('delete').addEventListener('click', () => {
  const key = current;
  const entry = entries[key];
  if (!entry) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  delete entries[key];
  persist();
  showDay(key);
  buzz(15);
  // Bilderna tas bort först när det inte längre går att ångra
  showToast(`${cap(dayPartFmt.format(parseKey(key)))} är borttagen.`, 'Ångra', () => {
    if (entries[key]) return;
    entries[key] = entry;
    persist();
    if (current === key) showDay(key);
    buzz(10);
  }, () => entryAssets(entry).forEach(removeAsset));
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
      <span class="on">${shortDate(k)}${e.weather ? `, ${escapeHtml(fmtWeather(e.weather))}` : ''}</span>
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

/* Flöde: varje dag som ett inlägg med datum, väder, text och stora bilder */


function postMedia(list) {
  if (!list || !list.length) return '';
  const shown = list.slice(0, 4);
  const extra = list.length - shown.length;
  return `<div class="media n${shown.length}">${shown.map((id, i) =>
    `<button type="button" data-photo="${escapeHtml(id)}" aria-label="Visa bild">
      <img src="${escapeHtml(photoUrl(id))}" data-id="${escapeHtml(id)}" alt="" loading="lazy">${
      i === 3 && extra > 0 ? `<span class="extra">+${extra}</span>` : ''}</button>`).join('')}</div>`;
}

function postHtml(k, e, today, searching) {
  const d = parseKey(k);
  const yesterday = shiftKey(today, -1);
  const rel = k === today ? 'Idag' : k === yesterday ? 'Igår' : '';
  const g = e.weather ? weatherGroup(e.weather.code) : null;
  const icon = g != null ? `<svg viewBox="0 0 24 24" aria-hidden="true">${WEATHER_ICONS[g]}</svg>` : '';
  const wx = e.weather ? icon + escapeHtml(fmtWeather(e.weather)) : '';
  const sub = [rel, wx].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>');
  return `<article class="post${k === today ? ' today' : ''}" data-key="${k}">
    <header class="post-head">
      <span class="avatar${e.mood ? '' : ' none'}" data-m="${e.mood || ''}" style="--m: var(--m${e.mood || 3})" aria-hidden="true">${['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'][d.getDay()]}</span>
      <div class="who">
        <button type="button" class="when">${shortDate(k)}</button>
        ${sub ? `<span class="sub">${sub}</span>` : ''}
      </div>
    </header>
    ${e.text ? `<div class="prose${searching ? '' : ' clamp'}">${Paper.mdToHtml(e.text)}</div>
    <button type="button" class="link more" hidden>Visa mer</button>` : ''}
    ${(e.media || []).map((f) => `<div class="post-film">${f.cover ? `<img src="${escapeHtml(photoUrl(f.cover))}" data-id="${escapeHtml(f.cover)}" alt="">` : ''}
      <span class="pf-kind">${KINDS[f.kind]}</span><span class="pf-title">${escapeHtml(f.title || 'Utan titel')}</span>${f.rating ? starsHtml(f.rating) : ''}</div>`).join('')}
    ${postMedia(e.photos)}
  </article>`;
}

// Långa inlägg visas förkortade tills man trycker på Visa mer
function markLongPosts(list) {
  list.querySelectorAll('.prose.clamp').forEach((p) => {
    if (p.scrollHeight > p.clientHeight + 2) p.nextElementSibling.hidden = false;
    else p.classList.remove('clamp');
  });
}

$('list').addEventListener('click', (ev) => {
  // Ett tryck var som helst på inlägget öppnar det för läsning, utom på bilder och Visa mer
  const post = ev.target.closest('.post');
  if (post && (ev.target.closest('.when') || !ev.target.closest('button, a')) && window.getSelection().isCollapsed) {
    openReader(post.dataset.key);
  }
  const more = ev.target.closest('.more');
  if (!more) return;
  more.previousElementSibling.classList.remove('clamp');
  more.hidden = true;
});

/* @-sökning: datum, månader, år, veckodagar och helgdagar */

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const WEEKDAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const HOLIDAY_GROUPS = {
  Påsk: ['Långfredagen', 'Påskafton', 'Påskdagen', 'Annandag påsk'],
  Jul: ['Julafton', 'Juldagen', 'Annandag jul'],
  Midsommar: ['Midsommarafton', 'Midsommardagen'],
  Nyår: ['Nyårsafton', 'Nyårsdagen'],
};
const AT_DEFAULTS = ['Idag', 'Igår', 'Julafton', 'Midsommarafton', 'Påsk', 'Nyårsafton', 'Helgdagar'];
const holidayCache = {};

const pad2 = (n) => String(n).padStart(2, '0');
const normAt = (s) => s.toLowerCase().replace(/[\s.\-]/g, '');

// Påskdagen enligt den gregorianska kalendern
function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

// Helgdagar för ett år, som datum (ÅÅÅÅ-MM-DD) till namn
function holidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const out = {};
  const put = (d, name) => { out[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`] = name; };
  const on = (m, d, name) => put(new Date(y, m - 1, d), name);
  const fromEaster = (n, name) => { const d = easter(y); d.setDate(d.getDate() + n); put(d, name); };
  // Första veckodagen wd (0 = söndag) från och med ett datum
  const firstFrom = (m, d, wd) => { const x = new Date(y, m - 1, d); x.setDate(d + ((wd - x.getDay() + 7) % 7)); return x; };
  on(1, 1, 'Nyårsdagen');
  on(1, 6, 'Trettondedag jul');
  on(2, 14, 'Alla hjärtans dag');
  fromEaster(-2, 'Långfredagen');
  fromEaster(-1, 'Påskafton');
  fromEaster(0, 'Påskdagen');
  fromEaster(1, 'Annandag påsk');
  on(4, 30, 'Valborg');
  on(5, 1, 'Första maj');
  fromEaster(39, 'Kristi himmelsfärds dag');
  const mors = firstFrom(5, 25, 0);
  put(mors, 'Mors dag');
  fromEaster(49, 'Pingstdagen');
  on(6, 6, 'Nationaldagen');
  const msa = firstFrom(6, 19, 5);
  put(msa, 'Midsommarafton');
  put(new Date(y, 5, msa.getDate() + 1), 'Midsommardagen');
  const helgon = firstFrom(10, 31, 6);
  put(new Date(helgon.getFullYear(), helgon.getMonth(), helgon.getDate() - 1), 'Allhelgonaafton');
  put(helgon, 'Alla helgons dag');
  put(firstFrom(11, 8, 0), 'Fars dag');
  on(12, 13, 'Lucia');
  on(12, 24, 'Julafton');
  on(12, 25, 'Juldagen');
  on(12, 26, 'Annandag jul');
  on(12, 31, 'Nyårsafton');
  holidayCache[y] = out;
  return out;
}

const HOLIDAY_NAMES = [...new Set(Object.values(holidays(2026)))];
const holidayOf = (k) => holidays(Number(k.slice(0, 4)))[k];

// Gör om texten efter @ till en etikett och ett test för datumnycklar
function parseAt(raw) {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  let year = null;
  const ym = s.match(/^(.*\D)\s+(\d{4})$/);
  if (ym) { s = ym[1].trim(); year = ym[2]; }
  const inYear = (k) => !year || k.startsWith(year);
  const withYear = (label) => (year ? `${label} ${year}` : label);
  const monthIdx = (w) => (w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w)) : -1);
  let m;

  if (s === 'idag' || s === 'igår') {
    const k = s === 'idag' ? todayKey() : shiftKey(todayKey(), -1);
    return { label: s === 'idag' ? 'Idag' : 'Igår', test: (x) => x === k };
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const k = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    return { label: shortDate(k), test: (x) => x === k };
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) {
    const p = `${m[1]}-${pad2(m[2])}`;
    const name = monthFmt.format(parseKey(p + '-01'));
    return { label: name.charAt(0).toUpperCase() + name.slice(1), test: (x) => x.startsWith(p) };
  }
  if ((m = s.match(/^(\d{4})$/))) return { label: m[1], test: (x) => x.startsWith(m[1]) };
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/))) {
    const md = `-${pad2(m[2])}-${pad2(m[1])}`;
    const y = m[3] || year;
    if (Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    return { label: `${Number(m[1])} ${MONTHS[m[2] - 1]}${y ? ` ${y}` : ''}`, test: (x) => x.endsWith(md) && (!y || x.startsWith(y)) };
  }
  if ((m = s.match(/^(\d{1,2})\s*([a-zåäö]+)$/)) && monthIdx(m[2]) >= 0) {
    const mi = monthIdx(m[2]);
    const md = `-${pad2(mi + 1)}-${pad2(m[1])}`;
    return { label: withYear(`${Number(m[1])} ${MONTHS[mi]}`), test: (x) => x.endsWith(md) && inYear(x) };
  }

  const n = normAt(s);
  if (n === 'helgdagar' || n === 'helgdag' || n === 'rödadagar') {
    return { label: withYear('Helgdagar'), test: (x) => !!holidayOf(x) && inYear(x) };
  }
  const group = Object.keys(HOLIDAY_GROUPS).find((g) => normAt(g) === n);
  const exact = HOLIDAY_NAMES.filter((h) => normAt(h) === n);
  if (group || exact.length) {
    const names = group ? HOLIDAY_GROUPS[group] : exact;
    return { label: withYear(group || exact[0]), test: (x) => names.includes(holidayOf(x)) && inYear(x) };
  }
  const mi = monthIdx(s);
  if (/^[a-zåäö]+$/.test(s) && mi >= 0) {
    const mm = `-${pad2(mi + 1)}-`;
    const name = MONTHS[mi];
    return { label: withYear(name.charAt(0).toUpperCase() + name.slice(1)), test: (x) => x.slice(4, 8) === mm && inYear(x) };
  }
  const wd = WEEKDAYS.findIndex((w) => s.length >= 3 && (w.startsWith(s) || s === `${w}ar`));
  if (/^[a-zåäö]+$/.test(s) && wd >= 0) {
    const name = WEEKDAYS[wd];
    return { label: withYear(`${name.charAt(0).toUpperCase() + name.slice(1)}ar`), test: (x) => parseKey(x).getDay() === wd && inYear(x) };
  }
  const prefix = [...Object.keys(HOLIDAY_GROUPS).flatMap((g) => (normAt(g).startsWith(n) ? HOLIDAY_GROUPS[g] : [])),
    ...HOLIDAY_NAMES.filter((h) => normAt(h).startsWith(n))];
  if (prefix.length) {
    const names = [...new Set(prefix)];
    const label = names.length <= 2 ? names.join(' och ') : `${names.slice(0, 2).join(', ')} med flera`;
    return { label: withYear(label), test: (x) => names.includes(holidayOf(x)) && inYear(x) };
  }
  return null;
}

// Delar sökningen i en @-del och vanlig text. @-delen är så många ord efter @ som
// går att tolka som ett datum, resten och det som står före @ är vanlig text.
function splitAt(q) {
  const i = q.indexOf('@');
  if (i < 0) return null;
  const words = q.slice(i + 1).trim().split(/\s+/).filter(Boolean);
  for (let n = words.length; n > 0; n--) {
    const at = parseAt(words.slice(0, n).join(' '));
    if (at) return { at, text: `${q.slice(0, i)} ${words.slice(n).join(' ')}`.trim(), rest: words.length - n };
  }
  return { at: null, text: q.slice(0, i).trim(), rest: 0, after: words.join(' ') };
}

// Förslag under sökfältet medan man skriver efter @
function renderAtSuggest() {
  $('search-clear').hidden = !$('search').value;
  const box = $('at-suggest');
  const v = $('search').value;
  const i = v.lastIndexOf('@');
  const sp = i < 0 ? null : splitAt(v.slice(i));
  // Inga förslag när man redan skriver vanlig text efter datumet
  if (!sp || sp.rest > 0 || (sp.at && /\s$/.test(v))) {
    box.hidden = true;
    return;
  }
  const n = normAt(v.slice(i + 1));
  const all = [...AT_DEFAULTS, ...Object.keys(HOLIDAY_GROUPS), ...HOLIDAY_NAMES,
    ...MONTHS.map((x) => x.charAt(0).toUpperCase() + x.slice(1))];
  const pool = n ? [...new Set(all)].filter((x) => normAt(x).startsWith(n)) : AT_DEFAULTS;
  const list = pool.filter((x) => normAt(x) !== n).slice(0, 8);
  box.hidden = !list.length;
  box.innerHTML = list.map((x) => `<button type="button" class="pill" data-at="${escapeHtml(x)}">@${escapeHtml(x)}</button>`).join('');
}

$('at-suggest').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-at]');
  if (!b) return;
  const v = $('search').value;
  $('search').value = `${v.slice(0, v.lastIndexOf('@'))}@${b.dataset.at} `;
  $('search').focus();
  shownCount = PAGE;
  renderAtSuggest();
  renderList();
});

/* Sortering av flödet. Allt utom Senaste först gäller hela dagboken. */

const SORTS = {
  newest: { note: '', order: (a, b) => (a < b ? 1 : -1) },
  oldest: { note: 'Äldsta först i hela dagboken', order: (a, b) => (a < b ? -1 : 1) },
  best: { note: 'Bästa dagarna i hela dagboken', keep: (e) => e.mood != null, order: (a, b) => entries[b].mood - entries[a].mood || (a < b ? 1 : -1) },
  worst: { note: 'Sämsta dagarna i hela dagboken', keep: (e) => e.mood != null, order: (a, b) => entries[a].mood - entries[b].mood || (a < b ? 1 : -1) },
  words: { note: 'Mest skrivet i hela dagboken', keep: (e) => wordCount(e) > 0, order: (a, b) => wordCount(entries[b]) - wordCount(entries[a]) || (a < b ? 1 : -1) },
  photos: { note: 'Flest bilder i hela dagboken', keep: (e) => (e.photos || []).length > 0, order: (a, b) => entries[b].photos.length - entries[a].photos.length || (a < b ? 1 : -1) },
};
const PAGE = 30;
let sortBy = 'newest';
let shownCount = PAGE;
let listMonth = '';

function wordCount(e) {
  return e.text ? Paper.mdToText(e.text).split(/\s+/).filter(Boolean).length : 0;
}

function renderList() {
  const q = $('search').value.trim();
  const lq = q.toLowerCase();
  const sort = SORTS[sortBy];
  const sp = splitAt(q);
  const isAt = !!sp;
  const at = sp ? sp.at : null;
  // Vanlig text att söka på, utan @-delen
  const text = sp ? sp.text : q;
  const lt = text.toLowerCase();
  // Utan sökning och sortering visas månaden i kalendern, annars hela dagboken
  const whole = !!lq || sortBy !== 'newest';
  const keys = Object.keys(entries).filter((k) => {
    const e = entries[k];
    if (!whole) return k.slice(0, 7) === calMonth;
    if (sort.keep && !sort.keep(e)) return false;
    if (isAt && !(at && at.test(k))) return false;
    if (!lt) return true;
    return [Paper.mdToText(e.text), fmtDate(k), e.weather ? fmtWeather(e.weather) : '', (e.people || []).join(' '), (e.media || []).map((f) => `${f.title} ${f.review}`).join(' ')]
      .some((t) => t.toLowerCase().includes(lt));
  }).sort(sort.order);

  const count = `${keys.length} ${keys.length === 1 ? 'dag' : 'dagar'}`;
  const note = !at ? sort.note
    : !keys.length ? at.label
    : text ? `${at.label}, ${count} med ”${text}”` : `${at.label}, ${count}`;
  $('sort-note').hidden = !note;
  $('sort-note').textContent = note;

  const list = $('list');
  // Flödet tonar in när kalendern byter månad
  if (!whole && listMonth && listMonth !== calMonth) {
    list.classList.remove('list-in');
    void list.offsetWidth;
    list.classList.add('list-in');
  }
  if (!whole) listMonth = calMonth;
  // Bara @ visar förslagen och inget annat
  if (isAt && !at && !sp.after) {
    list.innerHTML = '';
    return;
  }
  if (!keys.length) {
    list.innerHTML = `<p class="empty">${
      isAt && !at ? 'Känner inte igen datumet. Prova @julafton, @24 dec, @maj 2025 eller @lördagar.'
        : at && text ? 'Inga dagar matchar.'
        : at ? 'Inget skrivet då.'
        : whole ? 'Inga dagar matchar.' : `Inget skrivet i ${monthFmt.format(parseKey(calMonth + '-01'))}.`
    }</p>`;
    return;
  }

  const today = todayKey();
  const byMonth = whole && (sortBy === 'newest' || sortBy === 'oldest');
  let html = '';
  let month = '';
  for (const k of keys.slice(0, shownCount)) {
    const m = monthFmt.format(parseKey(k));
    if (byMonth && m !== month) {
      month = m;
      html += `<h2 class="month">${m}</h2>`;
    }
    html += postHtml(k, entries[k], today, !!text);
  }
  if (keys.length > shownCount) {
    html += `<button type="button" class="link show-more" id="show-more">Visa fler (${keys.length - shownCount} kvar)</button>`;
  }
  list.innerHTML = html;
  if (text) list.querySelectorAll('.when, .prose, .sub').forEach((el) => Paper.highlight(el, text));
  else markLongPosts(list);
}

$('search').addEventListener('input', () => {
  shownCount = PAGE;
  renderAtSuggest();
  renderList();
});
$('list').addEventListener('click', (ev) => {
  if (!ev.target.closest('#show-more')) return;
  shownCount += PAGE;
  renderList();
});

$('search-clear').addEventListener('click', () => {
  $('search').value = '';
  shownCount = PAGE;
  renderAtSuggest();
  renderList();
  $('search').focus();
});

// Långt tryck på en bild ska inte öppna webbläsarens meny
document.addEventListener('contextmenu', (ev) => {
  if (ev.target.closest('img')) ev.preventDefault();
});

const sortBtn = $('sort-btn');
const sortPop = $('sort-pop');

function toggleSort(open) {
  sortPop.hidden = !open;
  sortBtn.setAttribute('aria-expanded', String(open));
  if (open) sortPop.querySelector('[aria-checked="true"]').focus();
}

sortBtn.addEventListener('click', () => toggleSort(sortPop.hidden));
sortPop.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sort]');
  if (!b) return;
  sortBy = b.dataset.sort;
  shownCount = PAGE;
  sortPop.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  sortBtn.classList.toggle('on', sortBy !== 'newest');
  sortBtn.setAttribute('aria-label', `Sortera: ${b.textContent}`);
  toggleSort(false);
  renderList();
});
sortPop.addEventListener('keydown', (ev) => {
  const items = [...sortPop.querySelectorAll('[data-sort]')];
  const step = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
  if (!step) return;
  ev.preventDefault();
  items[(items.indexOf(document.activeElement) + step + items.length) % items.length].focus();
});
document.addEventListener('pointerdown', (ev) => {
  if (!sortPop.hidden && !$('sorter').contains(ev.target)) toggleSort(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !sortPop.hidden) {
    toggleSort(false);
    sortBtn.focus();
  }
});

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

/* Lagerknappen: en ruta med reglage för humör och väder i kalendern */

const layersBtn = $('layers-btn');
const layersPop = $('layers-pop');

function syncShow() {
  $('show-mood').checked = calShow.mood;
  $('show-weather').checked = calShow.weather;
  layersBtn.classList.toggle('on', calShow.mood || calShow.weather);
}

function changeShow(key, on) {
  calShow[key] = on;
  try { localStorage.setItem(SHOW_KEY, JSON.stringify(calShow)); } catch {}
  syncShow();
  renderCal();
}

function toggleLayers(open) {
  layersPop.hidden = !open;
  layersBtn.setAttribute('aria-expanded', String(open));
}

$('show-mood').addEventListener('change', (ev) => changeShow('mood', ev.target.checked));
$('show-weather').addEventListener('change', (ev) => changeShow('weather', ev.target.checked));
layersBtn.addEventListener('click', () => toggleLayers(layersPop.hidden));
// Ett tryck utanför eller Esc stänger rutan
document.addEventListener('pointerdown', (ev) => {
  if (!layersPop.hidden && !$('layers').contains(ev.target)) toggleLayers(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !layersPop.hidden) {
    toggleLayers(false);
    layersBtn.focus();
  }
});
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
  if (calPanel === 'media') renderMediaAll();
  renderBackupNotice();
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

// Bilderna i full bredd under texten, ett tryck öppnar bilden i helskärm
function bigPhotos(list) {
  if (!list || !list.length) return '';
  return `<div class="reader-photos">${list.map((id) =>
    `<button type="button" data-photo="${escapeHtml(id)}" aria-label="Visa bilden i helskärm">
      <img src="${escapeHtml(photoUrl(id))}" data-id="${escapeHtml(id)}" alt="" loading="lazy"></button>`).join('')}</div>`;
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
    ${(e.media || []).map((f, i) => `<button type="button" class="reader-film" data-key="${key}" data-i="${i}">${f.cover ? `<img src="${escapeHtml(photoUrl(f.cover))}" data-id="${escapeHtml(f.cover)}" alt="">` : ''}
      <div><div class="fs-kind">${KINDS[f.kind]}</div><div class="rf-title">${escapeHtml(f.title || 'Utan titel')}</div>${f.rating ? starsHtml(f.rating) : ''}</div></button>
`).join('')}
    ${bigPhotos(e.photos)}
    ${meta.length ? `<div class="meta">${meta.join(', ')}</div>` : ''}
    ${e.people && e.people.length ? `<div class="meta">Taggade personer: ${escapeHtml(joinNames(e.people))}</div>` : ''}
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
  $('reader-title').textContent = shortDate(key);
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

// Ett tryck på en film, serie eller bok visar den för läsning. Ändra öppnar fönstret för att redigera.
const filmView = $('film-view');
let filmViewing = null;
function openFilmView(key, i, item) {
  const f = item || ((entries[key] && entries[key].media) || [])[i];
  if (!f) return;
  filmViewing = { key, i };
  $('fv-kind').textContent = KINDS[f.kind];
  $('fv-title').textContent = f.title || 'Utan titel';
  $('fv-date').textContent = shortDate(key);
  $('fv-rating').innerHTML = f.rating ? starsHtml(f.rating) : '';
  $('fv-review').textContent = f.review;
  $('fv-review').hidden = !f.review;
  $('fv-cover').hidden = !f.cover;
  if (f.cover) $('fv-cover').src = photoUrl(f.cover);
  if (filmView.showModal) filmView.showModal();
  else filmView.setAttribute('open', '');
}
function closeFilmView() {
  if (filmView.close) filmView.close();
  else filmView.removeAttribute('open');
}
$('fv-close').addEventListener('click', closeFilmView);
filmView.addEventListener('click', (ev) => { if (ev.target === filmView) closeFilmView(); });
$('fv-edit').addEventListener('click', () => {
  const { key, i } = filmViewing;
  closeFilmView();
  if ($('reader').open) closeReader();
  if (!daySheet.hidden && current === key) {
    openFilm(i);
  } else {
    go(`#/dag/${key}`);
    setTimeout(() => openFilm(i), 60);
  }
});
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('.reader-film[data-i]');
  if (b) openFilmView(b.dataset.key, Number(b.dataset.i));
});

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

// Statistiken gäller senaste veckan, månaden eller året som kalendern visar, eller hela dagboken
const PERIOD_KEY = 'dagbok.statperiod';
let statPeriod = 'month';
try {
  const p = localStorage.getItem(PERIOD_KEY);
  if (p === 'week' || p === 'year' || p === 'all') statPeriod = p;
} catch {}

// Senaste veckan är de sju dagarna fram till och med idag
const weekStart = () => shiftKey(todayKey(), -6);
const weekMoods = (start) => Object.keys(entries)
  .filter((k) => k >= start && k <= shiftKey(start, 6) && entries[k].mood).map((k) => entries[k].mood);
function weekRange(start) {
  const a = parseKey(start);
  const b = parseKey(shiftKey(start, 6));
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${dayPartFmt.format(b)}`
    : `${dayPartFmt.format(a)}–${dayPartFmt.format(b)}`;
}

const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5) + 1;

function periodKeys(period, ym) {
  const all = Object.keys(entries).sort();
  if (period === 'all') return all;
  if (period === 'week') return all.filter((k) => k >= weekStart() && k <= todayKey());
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

  // Perioden syns redan i valet och i kalendern, bara veckans datum behöver stå ut
  $('month-stats-title').hidden = statPeriod !== 'week';
  $('month-stats-title').textContent = statPeriod === 'week' ? weekRange(weekStart()) : '';

  $('stats-body').hidden = !keys.length;
  $('stats-empty').hidden = !!keys.length;
  if (!keys.length) {
    $('stats-empty').textContent = statPeriod === 'all' ? 'Inget skrivet ännu.' : 'Inget skrivet under perioden.';
    return;
  }

  // Dagar som har passerat, så att en pågående period inte ser halvtom ut
  const today = todayKey();
  let passed;
  if (statPeriod === 'all') {
    passed = daysBetween(keys[0], today);
  } else if (statPeriod === 'week') {
    passed = 7;
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
    if (statPeriod === 'week') {
      prev = weekMoods(shiftKey(weekStart(), -7));
      prevName = 'veckan innan';
    } else if (statPeriod === 'month') {
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
    if (statPeriod === 'year' || statPeriod === 'all') {
      const byMonth = {};
      for (const k of keys) {
        if (entries[k].mood) (byMonth[k.slice(0, 7)] = byMonth[k.slice(0, 7)] || []).push(entries[k].mood);
      }
      const best = Object.entries(byMonth).filter(([, v]) => v.length >= 5)
        .map(([m, v]) => [m, avg(v)]).sort((x, y) => y[1] - x[1])[0];
      if (best) {
        const d = parseKey(best[0] + '-01');
        const label = statPeriod === 'year' ? monthOnlyFmt.format(d) : monthFmt.format(d);
        facts.push(['Bästa månad', `${cap(label)}, snitt ${fmtDec(best[1])}`]);
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
      facts.push(['Bästa veckodag', `${cap(weekdayFmt.format(sample))}ar, snitt ${fmtDec(bestDay[1])}`]);
    }

  }

  // Den man oftast har varit med under perioden, om någon finns med minst två dagar
  const met = {};
  for (const k of keys) {
    for (const n of entries[k].people || []) met[n] = (met[n] || 0) + 1;
  }
  const top = Object.entries(met).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) facts.push(['Oftast med', `${top[0]}, ${dagar(top[1])}`]);

  // Filmer, serier och böcker under perioden
  const seen = { film: 0, serie: 0, bok: 0 };
  for (const k of keys) {
    for (const f of entries[k].media || []) seen[f.kind]++;
  }
  const seenText = Object.entries(seen).filter(([, n]) => n)
    .map(([kind, n]) => `${n} ${KIND_COUNT[kind][n === 1 ? 0 : 1]}`);
  if (seenText.length) facts.push(['Sett och läst', joinNames(seenText)]);

  const s = streaks();
  if (s.longest >= 2) {
    facts.push(['Svit', s.current ? `${dagar(s.current)} i rad, längsta ${dagar(s.longest)}` : `Längsta ${dagar(s.longest)}`]);
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

// Staplarna i diagrammet: dagar för Vecka och Månad, månader för År och Totalt
let trendItems = {};
let trendCur = '';
function trendBuckets() {
  if (statPeriod === 'week') {
    return [...Array(7)].map((_, i) => {
      const k = shiftKey(weekStart(), i);
      const e = entries[k];
      const label = weekdayFmt.format(parseKey(k)).slice(0, 3);
      return { id: k, ms: e && e.mood ? [e.mood] : [], label, name: shortDate(k), day: true };
    });
  }
  if (statPeriod === 'month') {
    const [y, m] = calMonth.split('-').map(Number);
    return [...Array(new Date(y, m, 0).getDate())].map((_, i) => {
      const k = `${calMonth}-${pad(i + 1)}`;
      const e = entries[k];
      // Datum under den första och var femte dag, annars blir det trångt
      const label = i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : '';
      return { id: k, ms: e && e.mood ? [e.mood] : [], label, name: shortDate(k), day: true, future: k > todayKey() };
    });
  }
  return trendMonths().map((ym) => ({ id: ym, ms: monthMoods(ym), name: cap(monthFmt.format(parseKey(ym + '-01'))), future: ym > todayKey().slice(0, 7) }));
}

function renderTrend() {
  $('trend-title').textContent = statPeriod === 'year' ? `Snitthumör per månad ${calMonth.slice(0, 4)}`
    : statPeriod === 'all' ? 'Snitthumör per månad'
      : statPeriod === 'week' ? 'Humör per dag, senaste veckan'
        : `Humör per dag, ${monthFmt.format(parseKey(calMonth + '-01'))}`;
  const data = trendBuckets().map((d) => ({ ...d, avg: d.ms.length ? avg(d.ms) : null }));
  trendItems = Object.fromEntries(data.map((d) => [d.id, d]));
  trendCur = statPeriod === 'week' || statPeriod === 'month' ? todayKey() : calMonth;
  const n = data.length;
  // Staplar för Vecka, Månad och År, en linje med punkter för Totalt
  const bars = statPeriod !== 'all';
  const many = !bars && n > 12;
  const W = 340;
  const H = 128;
  const x0 = 22;
  const x1 = W - 8;
  const yOf = (v) => 12 + (5 - v) * 22; // 5 överst, 1 nederst
  const xOf = bars ? (i) => x0 + ((i + 0.5) * (x1 - x0)) / n : (i) => x0 + (i * (x1 - x0)) / (n - 1);
  const step = bars ? (x1 - x0) / n : (x1 - x0) / (n - 1);
  const base = yOf(1) + 8;

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
  if (path && !bars) svg += `<path class="ln" d="${path}"/>`;
  data.forEach((d, i) => {
    const cur = d.id === trendCur;
    if (bars) {
      const w = step * (n > 12 ? 0.7 : 0.56);
      const rx = Math.min(4, w / 2);
      // Snittets färg avrundas till närmaste humör
      if (d.avg != null) {
        svg += `<rect class="bar" x="${xOf(i) - w / 2}" y="${yOf(d.avg)}" width="${w}" height="${base - yOf(d.avg)}" rx="${rx}" style="fill: var(--m${Math.round(d.avg)}); animation-delay: ${Math.round(i * Math.min(40, 360 / n))}ms"/>`;
      } else if (!d.future) {
        svg += `<line class="nobar" x1="${xOf(i) - w / 2}" x2="${xOf(i) + w / 2}" y1="${base}" y2="${base}"/>`;
      }
    } else if (d.avg != null) {
      const r = cur ? 5.5 : many ? 3 : 4;
      svg += `<circle class="pt${cur ? ' cur' : ''}" cx="${xOf(i)}" cy="${yOf(d.avg)}" r="${r}"/>`;
    }
    // Dagar har veckodag eller datum. Med många månader står bara årtalet vid januari, annars månadens förkortning
    let label = '';
    if (d.label !== undefined) label = d.label;
    else if (!many) label = monthShortFmt.format(parseKey(d.id + '-01')).replace('.', '').slice(0, 3);
    else if (d.id.endsWith('-01') || i === 0) label = d.id.slice(0, 4);
    if (label) {
      svg += `<text class="lbl${cur && !many ? ' cur' : ''}" x="${xOf(i)}" y="${H - 4}" text-anchor="${many && i === 0 ? 'start' : 'middle'}">${label}</text>`;
    }
    // Träffyta större än punkten: visar månadens siffror vid tryck och hovring
    svg += `<rect class="hit" x="${xOf(i) - step / 2}" y="0" width="${step}" height="${H - 14}" data-id="${d.id}" tabindex="0" aria-label="${d.name}${d.avg != null ? `, ${d.day ? 'humör' : 'snitthumör'} ${fmtDec(d.avg)}` : ', inget humör'}"/>`;
  });
  svg += '</svg>';
  $('trend').innerHTML = svg;
  trendRead(trendCur);
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
  const order = ['week', 'month', 'year', 'all'];
  const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
  if (!step) return;
  ev.preventDefault();
  const next = order[(order.indexOf(statPeriod) + step + order.length) % order.length];
  choosePeriod(next);
  document.querySelector(`#stat-period [data-period="${next}"]`).focus();
});

function trendRead(id) {
  const d = trendItems[id];
  if (!d) return;
  if (d.day) {
    $('trend-read').textContent = `${d.name}: ${d.ms.length ? `humör ${d.ms[0]}` : 'inget humör'}`;
    return;
  }
  $('trend-read').textContent = d.ms.length
    ? `${d.name}: snitt ${fmtDec(avg(d.ms))}, ${dagar(d.ms.length)} med humör`
    : `${d.name}: inget humör`;
}

$('trend').addEventListener('pointerover', (ev) => {
  const r = ev.target.closest('.hit');
  if (r) trendRead(r.dataset.id);
});
$('trend').addEventListener('pointerleave', () => trendRead(trendCur));
$('trend').addEventListener('focusin', (ev) => {
  const r = ev.target.closest('.hit');
  if (r) trendRead(r.dataset.id);
});

/* Flöde, statistik eller sett och läst under kalendern */

const PANEL_KEY = 'dagbok.kalenderpanel';
const PANELS = [['feed', 'seg-feed', 'feed-panel'], ['stats', 'seg-stats', 'month-stats'], ['media', 'seg-media', 'media-panel']];
let calPanel = 'feed';
try {
  const saved = localStorage.getItem(PANEL_KEY);
  if (PANELS.some(([p]) => p === saved)) calPanel = saved;
} catch {}

function syncPanel() {
  for (const [p, tab, panel] of PANELS) {
    $(tab).setAttribute('aria-selected', String(p === calPanel));
    $(tab).tabIndex = p === calPanel ? 0 : -1;
    $(panel).hidden = p !== calPanel;
  }
  if (calPanel === 'media') renderMediaAll();
}

function choosePanel(p) {
  calPanel = p;
  try { localStorage.setItem(PANEL_KEY, p); } catch {}
  syncPanel();
}

for (const [p, tab] of PANELS) $(tab).addEventListener('click', () => choosePanel(p));
document.querySelector('.seg').addEventListener('keydown', (ev) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
  if (!step) return;
  ev.preventDefault();
  const i = PANELS.findIndex(([p]) => p === calPanel);
  const [p, tab] = PANELS[(i + step + PANELS.length) % PANELS.length];
  choosePanel(p);
  $(tab).focus();
});

/* Sett och läst i hela dagboken, en typ i taget, det senaste först */

let mediaKind = 'film';
// Lista eller rutnät, och sortering på datum, betyg eller namn. Sparas till nästa gång.
const MEDIA_KEY = 'dagbok.settlast';
let mediaOpts = { view: 'list', sort: 'date' };
try { mediaOpts = { ...mediaOpts, ...JSON.parse(localStorage.getItem(MEDIA_KEY)) }; } catch {}
const MEDIA_SORTS = {
  date: (a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0),
  // Utan betyg sist, samma betyg med det senaste först
  rating: (a, b) => (b[1].rating || 0) - (a[1].rating || 0) || MEDIA_SORTS.date(a, b),
  // Utan titel sist
  name: (a, b) => (!a[1].title) - (!b[1].title) || a[1].title.localeCompare(b[1].title, 'sv') || MEDIA_SORTS.date(a, b),
};
const KIND_COUNT = { film: ['film', 'filmer'], serie: ['serie', 'serier'], bok: ['bok', 'böcker'] };

function renderMediaAll() {
  document.querySelectorAll('#media-kind [data-kind]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.kind === mediaKind));
  });
  document.querySelectorAll('#media-sort [data-sort]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.sort === mediaOpts.sort));
  });
  document.querySelectorAll('.media-views [data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === mediaOpts.view);
    b.setAttribute('aria-pressed', String(b.dataset.view === mediaOpts.view));
  });
  const rows = [];
  for (const k of Object.keys(entries).sort().reverse()) {
    (entries[k].media || []).forEach((f, i) => { if (f.kind === mediaKind) rows.push([k, f, i]); });
  }
  rows.sort(MEDIA_SORTS[mediaOpts.sort] || MEDIA_SORTS.date);
  const grid = mediaOpts.view === 'grid';
  $('media-all').classList.toggle('grid-view', grid);
  const [one, many] = KIND_COUNT[mediaKind];
  $('media-count').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? one : many}` : `Inga ${many} ännu.`;
  $('media-all').innerHTML = grid ? rows.map(([k, f, i]) => `<button type="button" class="media-row media-tile" data-key="${k}" data-i="${i}"
    aria-label="${escapeHtml(f.title || 'Utan titel')}, ${shortDate(k)}${f.rating ? `, betyg ${f.rating} av 10` : ''}">
    ${f.cover ? `<img src="${escapeHtml(photoUrl(f.cover))}" data-id="${escapeHtml(f.cover)}" alt="">` : `<span class="mt-blank">${escapeHtml(f.title || 'Utan titel')}</span>`}
    <span class="mt-title">${escapeHtml(f.title || 'Utan titel')}</span>${f.rating ? starsHtml(f.rating) : ''}</button>`).join('')
    : rows.map(([k, f, i]) => `<button type="button" class="media-row" data-key="${k}" data-i="${i}">
    ${f.cover ? `<img src="${escapeHtml(photoUrl(f.cover))}" data-id="${escapeHtml(f.cover)}" alt="">` : '<span class="mr-blank" aria-hidden="true"></span>'}
    <span class="fs-text"><span class="fs-title">${escapeHtml(f.title || 'Utan titel')}</span>
      <span class="mr-meta">${shortDate(k)}${f.rating ? starsHtml(f.rating) : ''}</span></span></button>`).join('');
}

function setMediaOpt(key, value) {
  mediaOpts[key] = value;
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(mediaOpts)); } catch {}
  renderMediaAll();
}
$('media-sort').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sort]');
  if (b) setMediaOpt('sort', b.dataset.sort);
});
document.querySelector('.media-views').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-view]');
  if (b) setMediaOpt('view', b.dataset.view);
});
$('media-kind').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-kind]');
  if (!b) return;
  mediaKind = b.dataset.kind;
  renderMediaAll();
});
$('media-all').addEventListener('click', (ev) => {
  const b = ev.target.closest('.media-row');
  if (b) openFilmView(b.dataset.key, Number(b.dataset.i));
});
syncPanel();

function shiftMonth(n) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderCal();
}

attachSwipe({
  area: $('view-cal'),
  moving: $('cal-grid'),
  skip: '.seg, #feed-panel, #month-stats, #media-panel, .layers',
  canNext: () => calMonth < todayKey().slice(0, 7),
  step: (dir) => shiftMonth(dir),
});

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
    for (const id of entryAssets(e)) {
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
  a.download = `daysake-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  backupInfo.last = Date.now();
  delete backupInfo.later;
  saveBackupInfo();
  renderBackupNotice();
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
    for (const f of e.media) {
      if (!f.cover || photoUrls[f.cover]) continue;
      const src = images[f.cover];
      f.cover = null;
      if (typeof src === 'string' && src.startsWith('data:image/')) {
        try { f.cover = (await photoStore.upload(await (await fetch(src)).blob())).id; } catch {}
      }
    }
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

// Kalendern eller inställningarna ligger under, dagen öppnas som ett ark ovanpå
let baseView = 'cal';
let baseShown = false;

function showBase() {
  baseShown = true;
  for (const v of ['cal', 'set']) {
    $(`view-${v}`).hidden = v !== baseView;
    $(`tab-${v}`).classList.toggle('on', v === baseView);
  }
  refreshBase();
}

function refreshBase() {
  if (baseView === 'set') {
    renderSettings();
  } else {
    // Kalendern visar månaden för dagen som senast visades
    calSel = current;
    calMonth = current.slice(0, 7);
    renderCal();
  }
}

function closeSheet() { go(baseView === 'set' ? '#/installningar' : '#/kalender'); }

function route() {
  const hash = location.hash || '#/kalender';
  const day = hash.match(/^#\/dag(?:\/(\d{4}-\d{2}-\d{2}))?$/);
  if (day) {
    if (!baseShown) showBase();
    openSheet(day[1] || todayKey());
    return;
  }
  // Flödet ligger numera under kalendern, så gamla länkar dit öppnar kalendern
  baseView = hash.startsWith('#/installningar') ? 'set' : 'cal';
  if (baseView === 'set') $('wipe-msg').textContent = '';
  if (daySheet.hidden) {
    showBase();
    window.scrollTo(0, 0);
  } else {
    for (const v of ['cal', 'set']) {
      $(`view-${v}`).hidden = v !== baseView;
      $(`tab-${v}`).classList.toggle('on', v === baseView);
    }
    hideSheet();
  }
}

/* Dagen som ett ark som rullar upp */

const daySheet = $('day-sheet');
const dayPanel = $('sheet-panel');

function openSheet(key) {
  const wasOpen = !daySheet.hidden;
  daySheet.classList.remove('closing');
  dayPanel.style.transform = '';
  daySheet.hidden = false;
  document.body.classList.add('sheet-open');
  $('tab-day').classList.add('on');
  $('tab-day').setAttribute('aria-label', 'Stäng dagen');
  showDay(key);
  if (!wasOpen) dayPanel.scrollTop = 0;
}

// Stänger arket och visar vyn under med det som just skrivits
function hideSheet() {
  if (daySheet.hidden) return;
  flushSave();
  if (dayPanel.contains(document.activeElement)) document.activeElement.blur();
  document.body.classList.remove('sheet-open');
  $('tab-day').classList.remove('on');
  $('tab-day').setAttribute('aria-label', 'Dag');
  refreshBase();
  const done = () => {
    daySheet.hidden = true;
    daySheet.classList.remove('closing');
    dayPanel.style.transform = '';
    dayPanel.style.transition = '';
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else {
    daySheet.classList.add('closing');
    setTimeout(done, 220);
  }
}

$('sheet-close').addEventListener('click', () => closeSheet());
// Dag-knappen stänger dagen när den är öppen
$('tab-day').addEventListener('click', (ev) => {
  if (daySheet.hidden) return;
  ev.preventDefault();
  closeSheet();
});
$('sheet-backdrop').addEventListener('click', () => closeSheet());
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || daySheet.hidden || !$('lock').hidden) return;
  if (document.querySelector('dialog[open]')) return;
  closeSheet();
});

// Håller markören ovanför tangentbordet när man skriver i dagen
(() => {
  const vv = window.visualViewport;
  const paper = $('f-text');
  if (!vv || !paper) return;
  let raf = 0;
  function caretBottom() {
    const sel = window.getSelection();
    if (sel.rangeCount && paper.contains(sel.anchorNode)) {
      const rects = sel.getRangeAt(0).getClientRects();
      if (rects.length) return rects[rects.length - 1].bottom;
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      return el.getBoundingClientRect().bottom;
    }
    return paper.getBoundingClientRect().top + 60;
  }
  function keep() {
    raf = 0;
    if (document.activeElement !== paper || daySheet.hidden) return;
    // Tangentbordets höjd, så att arket kan rullas så långt att texten hamnar ovanför det
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    dayPanel.style.setProperty('--kb', `${Math.round(kb)}px`);
    const visible = Math.min(vv.offsetTop + vv.height, dayPanel.getBoundingClientRect().bottom) - 24;
    const over = caretBottom() - visible;
    if (over > 0) dayPanel.scrollTop += over;
  }
  const soon = () => { if (!raf) raf = requestAnimationFrame(keep); };
  paper.addEventListener('focus', () => {
    soon();
    // Tangentbordet glider upp en stund efter att rutan fått fokus
    setTimeout(soon, 300);
    setTimeout(soon, 650);
  });
  paper.addEventListener('input', soon);
  paper.addEventListener('blur', () => dayPanel.style.setProperty('--kb', '0px'));
  vv.addEventListener('resize', soon);
  vv.addEventListener('scroll', soon);
})();

// Svep nedåt för att stänga: från greppet, eller var som helst när arket är rullat högst upp
(() => {
  const grab = $('sheet-grab');
  let sx = 0;
  let sy = 0;
  let dy = 0;
  let t0 = 0;
  let mode = null; // null, 'start', 'drag' eller 'none'

  function move(y) {
    dy = Math.max(0, y);
    dayPanel.style.transform = `translateY(${dy}px)`;
  }
  function release() {
    const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.5;
    if (dy > 110 || fast) {
      dayPanel.style.transition = 'transform .2s ease-in';
      dayPanel.style.transform = 'translateY(100%)';
      setTimeout(() => closeSheet(), 180);
    } else {
      dayPanel.style.transition = 'transform .18s ease-out';
      dayPanel.style.transform = '';
    }
  }

  dayPanel.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 1 || ev.target.closest('button, input, dialog')) {
      mode = null;
      return;
    }
    sx = ev.touches[0].clientX;
    sy = ev.touches[0].clientY;
    dy = 0;
    t0 = Date.now();
    mode = 'start';
  }, { passive: true });

  dayPanel.addEventListener('touchmove', (ev) => {
    if (!mode || mode === 'none') return;
    const mx = ev.touches[0].clientX - sx;
    const my = ev.touches[0].clientY - sy;
    if (mode === 'start') {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      const atTop = dayPanel.scrollTop <= 0 || grab.contains(ev.target);
      const down = my > 0 && my > Math.abs(mx) * 1.2;
      mode = atTop && down && window.getSelection().isCollapsed ? 'drag' : 'none';
      if (mode !== 'drag') return;
      sy = ev.touches[0].clientY;
      t0 = Date.now();
      dayPanel.style.transition = 'none';
    }
    ev.preventDefault();
    move(ev.touches[0].clientY - sy);
  }, { passive: false });

  const touchEnd = () => {
    if (mode === 'drag') release();
    mode = null;
  };
  dayPanel.addEventListener('touchend', touchEnd);
  dayPanel.addEventListener('touchcancel', touchEnd);

  // Med mus går det att dra i greppet
  let dragging = false;
  grab.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch' || ev.target.closest('button')) return;
    dragging = true;
    sy = ev.clientY;
    dy = 0;
    t0 = Date.now();
    grab.setPointerCapture(ev.pointerId);
    dayPanel.style.transition = 'none';
  });
  grab.addEventListener('pointermove', (ev) => {
    if (dragging) move(ev.clientY - sy);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    release();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
})();

/* Påminnelse om säkerhetskopia, högst en gång i månaden */
const BACKUP_KEY = 'dagbok.kopia';
const DAY_MS = 864e5;
let backupInfo = {};
try { backupInfo = JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch {}

function saveBackupInfo() {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(backupInfo)); } catch {}
}

function renderBackupNotice() {
  const keys = Object.keys(entries).sort();
  const now = Date.now();
  const since = backupInfo.last || (keys.length ? parseKey(keys[0]).getTime() : now);
  const days = Math.floor((now - since) / DAY_MS);
  const show = keys.length >= 5 && days >= 30 && now > (backupInfo.later || 0);
  $('backup-notice').hidden = !show;
  if (show) {
    $('backup-text').textContent = backupInfo.last
      ? `Det var ${days} dagar sedan du sparade en kopia av dagboken.`
      : 'Du har inte sparat någon kopia av dagboken än.';
  }
  if (backupInfo.last) {
    const d = new Date(backupInfo.last);
    $('backup-last').textContent = `Senaste kopian sparades ${shortDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)}.`;
  } else {
    $('backup-last').textContent = 'Ingen kopia sparad än.';
  }
}

$('backup-now').addEventListener('click', () => $('export').click());
$('backup-later').addEventListener('click', () => {
  backupInfo.later = Date.now() + 7 * DAY_MS;
  saveBackupInfo();
  renderBackupNotice();
});

$('remind-add').addEventListener('click', () => {
  const blob = new Blob([reminderIcs(location.href.split('#')[0])], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daysake-paminnelse.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('remind-msg').textContent = `Öppna filen för att lägga in påminnelsen kl. ${remindAt}.`;
});

// Startskärmen tonar bort när appen har ritats upp
setTimeout(() => {
  const s = $('splash');
  if (!s) return;
  s.classList.add('gone');
  setTimeout(() => s.remove(), 350);
}, Math.max(0, 450 - performance.now()));

window.addEventListener('hashchange', route);
route();
loadPhotos().catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
