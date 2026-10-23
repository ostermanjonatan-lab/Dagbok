'use strict';

const STORE_KEY = 'dagbok.v1';
const POS_KEY = 'dagbok.plats';

const $ = (id) => document.getElementById(id);

const editor = Paper.createEditor($('f-text'), $('fmt'), () => scheduleSave());
const moodButtons = [...$('f-mood').querySelectorAll('button')];

let entries = normalizeAll(load());
let current = todayKey();
let saveTimer = null;

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

async function fetchWeather(key) {
  const { lat, lon } = await getPosition();
  const base = `latitude=${lat}&longitude=${lon}&timezone=auto`;
  if (wantsNow(key)) {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${base}&current=temperature_2m,weather_code`);
    if (!res.ok) throw new Error('väder');
    const data = await res.json();
    return {
      code: data.current.weather_code,
      temp: data.current.temperature_2m,
      time: timeFmt.format(new Date()),
    };
  }
  // Prognos-API:t har de senaste månaderna, arkivet allt äldre.
  const old = (Date.now() - parseKey(key).getTime()) / 864e5 > 80;
  const host = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const res = await fetch(`${host}?${base}&start_date=${key}&end_date=${key}&hourly=temperature_2m,weather_code`);
  if (!res.ok) throw new Error('väder');
  const data = await res.json();
  const i = data.hourly.time.indexOf(`${key}T12:00`);
  if (i === -1 || data.hourly.temperature_2m[i] == null) throw new Error('väder');
  return { code: data.hourly.weather_code[i], temp: data.hourly.temperature_2m[i], time: '12:00' };
}

const weatherBusy = new Set();

async function updateWeather(key) {
  const e = entries[key];
  if (!e || weatherBusy.has(key)) return;
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

/* Dagvy */

function readForm() {
  const checked = moodButtons.find((b) => b.getAttribute('aria-checked') === 'true');
  return {
    text: editor.get(),
    mood: checked ? Number(checked.dataset.v) : null,
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
  if (!data.text && data.mood == null) {
    if (!entries[current]) return;
    delete entries[current];
    persist();
    showWeather(null);
    setStatus('');
    $('delete').hidden = true;
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
  delete entries[current];
  persist();
  showDay(current);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

/* Flöde */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderList() {
  const q = $('search').value.trim();
  const lq = q.toLowerCase();
  const keys = Object.keys(entries).sort().reverse().filter((k) => {
    if (!lq) return true;
    const e = entries[k];
    return [Paper.mdToText(e.text), fmtDate(k), e.weather ? fmtWeather(e.weather) : '']
      .some((t) => t.toLowerCase().includes(lq));
  });

  const list = $('list');
  if (!keys.length) {
    list.innerHTML = `<p class="empty">${
      q ? 'Inga dagar matchar sökningen.' : 'Inget skrivet ännu.'
    }</p>`;
    return;
  }

  const today = todayKey();
  let html = '';
  let month = '';
  for (const k of keys) {
    const e = entries[k];
    const m = monthFmt.format(parseKey(k));
    if (m !== month) {
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
  45: '<path d="M4 9h16M6 13h12M4 17h16"/>',
};

// Samma grupper som väderknapparna: klart, halvklart, mulet, regn, snö, åska, dimma
function weatherGroup(code) {
  if (code == null) return null;
  if (code <= 1) return 0;
  if (code === 2 || code === 3) return code;
  if (code === 45 || code === 48) return 45;
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

try {
  // Tidigare fanns två kryssrutor, de blir ett val här
  let show = localStorage.getItem(SHOW_KEY);
  if (show == null) {
    show = localStorage.getItem('dagbok.humorfilter') === '1' ? 'mood'
      : localStorage.getItem('dagbok.vaderfilter') === '1' ? 'weather' : '';
  }
  $('cal-show').value = show;
} catch {}

function renderCal() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const today = todayKey();
  const moods = $('cal-show').value === 'mood';
  const weathers = $('cal-show').value === 'weather';

  $('cal-title').textContent = monthFmt.format(first);
  $('cal-next').disabled = calMonth >= today.slice(0, 7);
  $('cal-grid').classList.toggle('moods', moods);
  $('cal-grid').classList.toggle('weathers', weathers);
  $('legend').hidden = !moods;

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

function shiftMonth(n) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderCal();
}

$('cal-prev').addEventListener('click', () => shiftMonth(-1));
$('cal-next').addEventListener('click', () => shiftMonth(1));
$('cal-show').addEventListener('change', () => {
  try { localStorage.setItem(SHOW_KEY, $('cal-show').value); } catch {}
  renderCal();
});
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

$('export').addEventListener('click', () => {
  flushSave();
  const blob = new Blob([JSON.stringify({ app: 'dagbok', version: 2, entries }, null, 2)],
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
  try {
    const data = JSON.parse(await file.text());
    incoming = data.entries || data;
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
  const view = hash.startsWith('#/flode') || hash.startsWith('#/alla') ? 'all' : hash.startsWith('#/kalender') ? 'cal' : 'day';
  if (view !== 'day') flushSave();
  for (const v of ['day', 'cal', 'all']) {
    $(`view-${v}`).hidden = v !== view;
    $(`tab-${v}`).classList.toggle('on', v === view);
  }

  if (view === 'all') {
    renderList();
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
