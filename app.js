'use strict';

const STORE_KEY = 'dagbok.v1';

const $ = (id) => document.getElementById(id);

const fields = {
  highlight: $('f-highlight'),
  notes: $('f-notes'),
  grateful: $('f-grateful'),
  sleep: $('f-sleep'),
  tags: $('f-tags'),
};
const moodButtons = [...$('f-mood').querySelectorAll('button')];

let entries = load();
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

function fmtNumber(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function parseNumber(str) {
  const n = parseFloat(String(str).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

/* Dagvy */

function isEmpty(e) {
  return !e || (!e.highlight && !e.notes && !e.grateful && !e.tags.length &&
    e.mood == null && e.sleep == null);
}

function readForm() {
  const sleep = parseNumber(fields.sleep.value);
  const checked = moodButtons.find((b) => b.getAttribute('aria-checked') === 'true');
  return {
    highlight: fields.highlight.value.trim(),
    notes: fields.notes.value.trim(),
    grateful: fields.grateful.value.trim(),
    tags: fields.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    mood: checked ? Number(checked.dataset.v) : null,
    sleep: sleep != null && sleep >= 0 && sleep <= 24 ? sleep : null,
  };
}

function setMood(v) {
  moodButtons.forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.v) === v));
  });
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

function showDay(key) {
  flushSave();
  const today = todayKey();
  if (key > today) key = today;
  current = key;

  const e = entries[key] || {};
  fields.highlight.value = e.highlight || '';
  fields.notes.value = e.notes || '';
  fields.grateful.value = e.grateful || '';
  fields.tags.value = (e.tags || []).join(', ');
  fields.sleep.value = e.sleep != null ? fmtNumber(e.sleep) : '';
  setMood(e.mood ?? null);

  $('date-label').textContent = fmtDate(key);
  $('date-pick').value = key;
  $('date-pick').max = today;
  $('next').disabled = key >= today;
  $('to-today').hidden = key === today;
  $('delete').hidden = !entries[key];
  setStatus(e.updated ? savedText(e.updated) : '');

  requestAnimationFrame(() => {
    autosize(fields.highlight);
    autosize(fields.notes);
  });
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
  if (isEmpty(data)) {
    if (!entries[current]) return;
    delete entries[current];
    persist();
    setStatus('');
    $('delete').hidden = true;
    return;
  }
  data.updated = new Date().toISOString();
  entries[current] = data;
  if (persist()) {
    setStatus(savedText(data.updated));
  } else {
    setStatus('Kunde inte spara. Lagringen kan vara full eller avstängd.');
  }
  $('delete').hidden = false;
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

Object.values(fields).forEach((el) => {
  el.addEventListener('input', () => {
    if (el.tagName === 'TEXTAREA') autosize(el);
    scheduleSave();
  });
});

fields.sleep.addEventListener('blur', () => {
  const n = readForm().sleep;
  fields.sleep.value = n != null ? fmtNumber(n) : '';
});

moodButtons.forEach((b) => {
  b.addEventListener('click', () => {
    const v = Number(b.dataset.v);
    const on = b.getAttribute('aria-checked') === 'true';
    setMood(on ? null : v);
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

/* Listvy */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function highlightMatch(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const re = new RegExp(escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}

function snippet(e, q) {
  const main = e.highlight || e.notes || e.grateful || '';
  if (!q) return main;
  const lq = q.toLowerCase();
  for (const t of [e.highlight, e.notes, e.grateful]) {
    const i = (t || '').toLowerCase().indexOf(lq);
    if (i === -1) continue;
    if (i < 60) return t;
    return '…' + t.slice(i - 30);
  }
  return main;
}

function renderList() {
  const q = $('search').value.trim();
  const lq = q.toLowerCase();
  const keys = Object.keys(entries).sort().reverse().filter((k) => {
    if (!lq) return true;
    const e = entries[k];
    return [e.highlight, e.notes, e.grateful, e.tags.join(' '), fmtDate(k)]
      .some((t) => (t || '').toLowerCase().includes(lq));
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
    const meta = [];
    if (e.mood != null) meta.push(`Humör ${e.mood}`);
    if (e.sleep != null) meta.push(`Sömn ${fmtNumber(e.sleep)} h`);
    if (e.tags.length) meta.push(e.tags.join(', '));
    html += `<a class="item${k === today ? ' today' : ''}" href="#/dag/${k}">
      <div class="when">${fmtDate(k)}</div>
      <div class="what">${highlightMatch(snippet(e, q), q)}</div>
      ${meta.length ? `<div class="meta">${highlightMatch(meta.join(', '), q)}</div>` : ''}
    </a>`;
  }
  list.innerHTML = html;
}

$('search').addEventListener('input', renderList);

/* Säkerhetskopia */

$('export').addEventListener('click', () => {
  flushSave();
  const blob = new Blob([JSON.stringify({ app: 'dagbok', version: 1, entries }, null, 2)],
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
    if (typeof incoming !== 'object') throw new Error();
  } catch {
    alert('Filen gick inte att läsa. Välj en fil som exporterats från dagboken.');
    return;
  }
  let added = 0;
  let replaced = 0;
  for (const [k, e] of Object.entries(incoming)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !e || typeof e !== 'object') continue;
    const clean = {
      highlight: String(e.highlight || ''),
      notes: String(e.notes || ''),
      grateful: String(e.grateful || ''),
      tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
      mood: Number.isInteger(e.mood) && e.mood >= 1 && e.mood <= 5 ? e.mood : null,
      sleep: typeof e.sleep === 'number' ? e.sleep : null,
      updated: e.updated || new Date().toISOString(),
    };
    const old = entries[k];
    if (!old) { entries[k] = clean; added++; }
    else if ((clean.updated || '') > (old.updated || '')) { entries[k] = clean; replaced++; }
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
  const isAll = hash.startsWith('#/alla');
  $('view-day').hidden = isAll;
  $('view-all').hidden = !isAll;
  $('tab-day').classList.toggle('on', !isAll);
  $('tab-all').classList.toggle('on', isAll);

  if (isAll) {
    flushSave();
    renderList();
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
