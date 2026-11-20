import { config } from './config.js';
import * as C from './core.js';
import * as store from './storage.js';
import { prefs } from './storage.js';
import * as spotify from './spotify.js';
import * as discogs from './discogs.js';
import * as fb from './firebase.js';
import * as collection from './collection.js';
import { readSpotifyZip } from './zip.js';
import { h, safeUrl } from './dom.js';
import { buildStats, mergeStats } from './stats.js';
import * as L from './live.js';
import { artistsView, tracksView, statsView } from './statsview.js';
import * as W from './wishlist.js';
import * as cloud from './cloud.js';
import * as wv from './wishview.js';
import { concertsView } from './concertsview.js';
import { trackCover, albumCover, knownCovers } from './covers.js';
import * as imgcache from './imgcache.js';

const VERSION = '1.7.1';
const applyTheme = v => { if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; };
applyTheme(prefs.get('theme'));
// iOS (app instalada): al abrirla, el alto del documento a veces sale ~59 px más corto que la pantalla
// (el de la barra de estado) y la barra inferior se queda flotando con un hueco debajo.
// Se usa el alto real de la pantalla; en el navegador normal no se toca nada.
const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function fixAppHeight() {
  if (!isStandalone()) return;
  if (Math.abs(innerWidth - screen.width) > 1 && Math.abs(innerWidth - screen.height) > 1) return;   // ventana más pequeña que la pantalla (iPad con pantalla dividida): no tocar
  const landscape = window.matchMedia && matchMedia('(orientation: landscape)').matches;
  const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  if (full > 0) document.documentElement.style.setProperty('--app-h', full + 'px');
}
fixAppHeight();
for (const ev of ['resize', 'orientationchange', 'pageshow']) window.addEventListener(ev, fixAppHeight);
document.addEventListener('visibilitychange', fixAppHeight);   // iOS vuelve a descuadrarlo al reabrir la app
setTimeout(fixAppHeight, 300); setTimeout(fixAppHeight, 1200);

const $ = s => document.querySelector(s);
const view = $('#view');
// Sin zoom: iOS ignora a veces user-scalable=no, así que se bloquean también los gestos de pellizco
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());

// ---------- utilidades de interfaz (todo con textContent: nada de HTML de terceros) ----------
const when = ts => (ts ? new Date(ts).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 7000 : 3500);
}
const setStatus = s => { $('#status').textContent = s || ''; };

// Portadas conocidas (API de Spotify + registro en vivo), recalculadas solo cuando cambian
let knownMemo = { api: null, live: null, map: {} };
function known() {
  if (knownMemo.api !== state.apiAlbums || knownMemo.live !== state.live) knownMemo = { api: state.apiAlbums, live: state.live, map: knownCovers({ apiAlbums: state.apiAlbums, live: state.live }) };
  return knownMemo.map;
}
// Álbum o single; si no trae portada se busca (Spotify / iTunes) y se guarda. Lo ya visto sale al instante.
const coverEl = (a, cls = '') => albumCover(a, known(), cls);

// ---------- estado ----------
const state = {
  tab: prefs.get('tab', 'ranking'),
  months: Number(prefs.get('months', '12')),
  history: {}, apiAlbums: {}, apiAt: 0, historyInfo: null,
  base: [], extras: [], extrasAt: 0, owned: null, collection: [],
  storeIndex: [], storeDate: '',
  stats: null, rankView: prefs.get('rankView', 'albums'),
  live: L.emptyLive(), liveStats: null, liveHistory: {}, effStats: null, effHistory: {},
  now: undefined, nowError: '', liveBusy: false, liveError: '',
  csvAt: 0, syncing: false, syncError: '',
  prices: new Map(),          // key -> { discogs }
  filter: 'todos', search: '',
  cloudAt: 0, cloudError: '', cloudBusy: false, wish: [], buyView: prefs.get('buyView', 'sugeridos'), scanStop: null, wishBusy: false
};

// Lo que ven las pantallas es lo importado MÁS lo recogido en vivo
function recompute() {
  const entries = L.toEntries(state.live);
  state.liveStats = entries.length ? buildStats(entries) : null;
  state.liveHistory = entries.length ? C.aggregateHistory(entries, {}).into : {};
  state.effStats = mergeStats(state.stats, state.liveStats);
  state.effHistory = C.mergeHistory(state.history, state.liveHistory);
}

const rankingList = () => C.buildRanking({ history: state.effHistory, api: state.apiAlbums, months: state.months })
  .map(r => ({ ...r, owned: C.isOwned(r, state.owned), offers: C.matchStores(r, state.storeIndex) }));

async function loadAll() {
  imgcache.preload().catch(() => {});
  state.history = C.rekeyHistory(await store.get('history', {}));
  state.historyInfo = await store.get('historyInfo', null);
  state.stats = await store.get('stats', null);
  const lv = await store.get('live', null);
  if (lv) state.live = { ...L.emptyLive(), ...lv };
  recompute();
  const api = await store.get('api', null);
  if (api) { state.apiAlbums = C.rekeyApi(api.albums); state.apiAt = api.at; }
  try { state.base = await collection.loadBase(); } catch (e) { toast('No se pudo leer tu colección de mi-app: ' + e.message, true); }
  state.wish = await store.get('wishlist', []);
  const ex = await fb.cachedExtras();
  if (ex) { state.extras = ex.albums; state.extrasAt = ex.at; }
  state.csvAt = await collection.csvAt();
  rebuildCollection();
  try {
    const r = await fetch('data/stores.json');
    const d = await r.json();
    state.storeIndex = C.indexStores(d); state.storeDate = d.generated;
  } catch (e) { /* sin datos de tiendas todavía */ }
}

function rebuildCollection() {
  state.collection = collection.combine(state.base, state.extras);
  state.owned = C.ownedIndex(state.collection);
}

// ---------- navegación ----------
function go(tab) {
  state.tab = tab; prefs.set('tab', tab);
  markTab();
  render();
  view.scrollTop = 0;
}
function markTab() {
  document.querySelectorAll('.tabs button').forEach(b => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));

function render() {
  view.replaceChildren(({ ranking: vRanking, coleccion: vCollection, comprar: vBuy, conciertos: vConcerts, ajustes: vSettings })[state.tab]());
  setStatus('');
}

// ---------- Ranking ----------
function periodBar() {
  const opts = [[1, '1 mes'], [6, '6 meses'], [12, '1 año'], [0, 'Todo']];
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Periodo' },
    opts.map(([m, label]) => h('button', {
      'aria-pressed': String(state.months === m),
      onclick: () => { state.months = m; prefs.set('months', String(m)); render(); }
    }, label)));
}

function metric(r) {
  if (r.minutes) return h('div', { class: 'm' }, h('b', null, Math.round(r.minutes) + ' min'), r.plays + ' reprod.');
  return h('div', { class: 'm' }, h('b', null, r.points + ' pts'), r.saved ? 'guardado' : 'Spotify');
}

function priceChip(r) {
  const d = state.prices.get(r.key);
  const est = C.estimate({ discogs: d }, r.offers);
  if (est == null) return null;
  const o = C.bestOffer(r.offers);
  const live = o && (o.available || o.preorder);
  return h('span', { class: 'chip ' + (live ? 'ok' : '') }, C.money(est));
}

function albumRow(r, i) {
  return h('li', null, h('button', { class: 'row', onclick: () => openSheet(r) },
    h('div', { class: 'n' }, i + 1), coverEl(r),
    h('div', { class: 't' }, h('b', null, r.name), h('span', null, r.artist),
      r.owned ? h('span', { class: 'own' }, '✓ En tu colección') : r.wished ? h('span', { class: 'chip' }, '♡ En deseos') : priceChip(r)),
    metric(r)));
}

const RANK_VIEWS = [['albums', 'Álbumes'], ['artists', 'Artistas'], ['tracks', 'Canciones'], ['stats', 'Estadísticas']];

function rankTabs() {
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' },
    RANK_VIEWS.map(([k, label]) => h('button', { 'aria-pressed': String(state.rankView === k), onclick: () => { state.rankView = k; prefs.set('rankView', k); render(); } }, label)));
}

function vRanking() {
  const root = h('div');
  const hasHistory = Object.keys(state.effHistory).length > 0;
  const hasApi = Object.keys(state.apiAlbums).length > 0;
  if (!hasHistory && !hasApi && !state.effStats) {
    root.append(h('div', { class: 'empty' },
      h('p', null, 'Todavía no hay datos de escucha.'),
      h('p', { class: 'muted' }, 'Conecta Spotify o importa tu historial (export de datos) en Ajustes.'),
      h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => go('ajustes') }, 'Ir a Ajustes'))));
    return root;
  }
  root.append(...[liveBar(), nowCard(), rankTabs()].filter(Boolean));
  const view = state.rankView;
  const goSettings = () => go('ajustes');
  // El periodo vale para todas las vistas que usan el historial
  if (hasHistory || state.effStats) root.append(periodBar());
  if (view === 'artists') { root.append(artistsView({ stats: state.effStats, apiAlbums: state.apiAlbums, months: state.months, onImport: goSettings })); return root; }
  if (view === 'tracks') { root.append(tracksView({ stats: state.effStats, months: state.months, onImport: goSettings,
    cover: t => trackCover(t, known()) })); return root; }
  if (view === 'stats') {
    root.append(statsView({ stats: state.effStats, history: state.effHistory, collection: state.collection, ranking: rankingList().slice(0, 40),
      months: state.months, onImport: goSettings }));
    return root;
  }
  if (!hasHistory && !hasApi) {
    root.append(h('div', { class: 'empty' }, h('p', null, 'Tu export no trae nombres de álbum.'),
      h('p', { class: 'muted' }, 'Es el paquete básico ("Datos de la cuenta"). Mira Artistas, Canciones y Estadísticas. Para ver álbumes, conecta Spotify o importa el "Historial de reproducciones ampliado".')));
    return root;
  }
  if (!hasHistory) root.append(h('p', { class: 'muted' }, 'Ranking aproximado con tus tops de Spotify. Para minutos reales importa el export de tu historial en Ajustes.'));
  const list = rankingList().slice(0, 60);
  const sources = [hasHistory && 'historial', hasApi && 'API de Spotify'].filter(Boolean).join(' + ');
  root.append(h('div', { class: 'chips' }, h('span', { class: 'chip' }, 'Fuente: ' + sources),
    h('span', { class: 'chip' }, list.filter(r => r.owned).length + ' ya los tienes')));
  if (!list.length) root.append(h('div', { class: 'empty' }, 'No hay reproducciones en este periodo.'));
  else root.append(h('ul', { class: 'list' }, list.map(albumRow)));
  return root;
}

// ---------- En vivo: lo que escuchas ahora y lo que acabas de escuchar ----------
const liveStatus = () => C.syncStatus({ online: navigator.onLine !== false, syncing: state.liveBusy, error: state.liveError, lastSyncAt: state.live.at, now: Date.now() });
const liveText = () => (!spotify.isConnected() ? 'Spotify sin conectar' : state.liveBusy ? 'Actualizando…' : state.liveError ? 'Error al actualizar'
  : state.live.at ? `En vivo · ${C.relativeTime(state.live.at, Date.now())}` : 'En vivo · todavía sin datos');

function updateLiveUi() {
  const dot = $('#live-dot'), btn = $('#live-refresh'), txt = $('#live-text');
  if (dot) { const st = liveStatus(); dot.dataset.state = st.state; dot.title = st.label; dot.setAttribute('aria-label', 'En vivo: ' + st.label); }
  if (btn) { btn.classList.toggle('spin', state.liveBusy); btn.disabled = state.liveBusy; }
  if (txt) txt.textContent = liveText();
  const bar = $('#now-bar');
  if (bar && state.now && state.now.duration) bar.style.width = Math.min(100, state.now.progress / state.now.duration * 100) + '%';
}
window.addEventListener('online', updateLiveUi);

function liveBar() {
  if (!spotify.isConnected()) {
    return h('div', { class: 'livebar' }, h('span', { class: 'muted' }, 'Conecta Spotify para ver lo que escuchas en vivo'),
      h('button', { class: 'btn sec sm', onclick: () => go('ajustes') }, 'Conectar'));
  }
  const dot = h('button', { class: 'sync-dot', id: 'live-dot', type: 'button', onclick: () => {
    const st = liveStatus();
    toast(`${st.label}. ${st.detail}` + (state.live.gap ? ' Posible hueco: escuchaste más de 50 canciones desde la última vez.' : ''), st.state === 'error');
  } });
  const btn = h('button', { class: 'iconbtn sm', id: 'live-refresh', type: 'button', 'aria-label': 'Actualizar ahora', title: 'Actualizar ahora',
    onclick: () => { liveRefresh(); nowRefresh(); } }, icon(SYNC_ICON));
  queueMicrotask(updateLiveUi);
  return h('div', { class: 'livebar' }, dot, h('span', { id: 'live-text', class: 'muted' }, liveText()), btn);
}

function nowCard() {
  const n = state.now;
  if (!n) return state.nowError ? h('div', { class: 'card' }, h('p', { class: 'muted' }, state.nowError), h('button', { class: 'btn sec sm', onclick: () => go('ajustes') }, 'Ir a Ajustes')) : null;
  const album = { key: C.albumKey(n.artist, n.album), artist: n.artist, name: n.album, id: n.albumId, image: n.image };
  album.owned = C.isOwned(album, state.owned);
  album.offers = C.matchStores(album, state.storeIndex);
  const pct = n.duration ? Math.min(100, n.progress / n.duration * 100) : 0;
  return h('button', { class: 'nowcard', onclick: () => openSheet(album) }, coverEl(album),
    h('div', { class: 't' }, h('span', { class: 'nowlbl' }, n.playing ? '♪ Suena ahora' : '⏸ En pausa'), h('b', null, n.title), h('span', null, `${n.artist} · ${n.album}`),
      album.owned ? h('span', { class: 'own' }, '✓ En tu colección') : h('span', { class: 'chip' }, 'No lo tienes en vinilo'),
      h('div', { class: 'bar' }, h('i', { id: 'now-bar', style: `width:${pct}%` }))));
}

// Recoge lo último que has escuchado y lo suma al registro (se guarda en el móvil)
async function liveRefresh() {
  if (!spotify.isConnected() || state.liveBusy) return;
  state.liveBusy = true; updateLiveUi();
  try {
    const incoming = await spotify.fetchRecent(state.live.cursor || 0);
    const { live, fresh } = L.mergeLive(state.live, incoming, state.stats ? state.stats.total.lastTs : 0);
    state.live = { ...live, at: Date.now() };
    state.liveError = '';
    await store.set('live', state.live);
    if (fresh.length) { scheduleCloud('live'); recompute(); if (state.tab === 'ranking') render(); }
  } catch (e) { state.liveError = e.message; }
  finally { state.liveBusy = false; updateLiveUi(); }
}

async function nowRefresh() {
  if (!spotify.isConnected()) { state.now = undefined; return; }
  try {
    const prev = state.now, n = await spotify.fetchNowPlaying();
    state.now = n; state.nowError = '';
    const changed = (prev && prev.uri) !== (n && n.uri) || (prev && prev.playing) !== (n && n.playing);
    if (state.tab === 'ranking') { if (changed) render(); else updateLiveUi(); }
  } catch (e) {
    state.now = null; state.nowError = e.code === 'scope' ? e.message : '';
    if (state.tab === 'ranking') render();
  }
}

// Mientras la app está abierta: lo que suena cada 15 s y las últimas canciones cada minuto; también al volver a ella
let liveTick = 0;
function startLive() {
  const run = () => {
    if (document.visibilityState !== 'visible' || !spotify.isConnected()) return;
    nowRefresh();
    if (liveTick++ % 4 === 0) liveRefresh();
  };
  setInterval(run, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { liveTick = 0; run(); } });
  window.addEventListener('online', run);
  run();
}

// ---------- Colección (como la app Vinilos de mi-app) ----------
function tileEl(a) {
  const letter = (a.name || a.artist || '?').trim().charAt(0).toUpperCase();
  const ph = () => h('div', { class: 'ph' }, letter);
  const media = a.image ? imgcache.cachedImg(a.image, { onFail: img => img.replaceWith(ph()) }) : ph();
  const cap = h('span', { class: 'cap' }, h('b', null, a.name), h('i', null, a.artist));
  const link = safeUrl(a.url);
  // Como en mi-app: tocar una portada abre el álbum en Spotify
  return link !== '#'
    ? h('a', { class: 'tile', href: link, target: '_blank', rel: 'noopener' }, media, cap)
    : h('button', { class: 'tile', onclick: () => openSheet({ ...a, key: C.albumKey(a.artist, a.name), owned: true, offers: [] }) }, media, cap);
}

// ---------- Estado de sincronización (punto de color como en mi-app) ----------
const SYNC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 00-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0014.5 4.5L20 16"/><path d="M20 20v-4h-4"/></svg>';
const icon = svg => { const t = document.createElement('template'); t.innerHTML = svg; return t.content.firstChild; };

// Última lectura completa: con sesión, la más antigua entre el CSV y la nube; sin sesión, solo el CSV
const syncedAt = () => (fb.isLoggedIn() ? Math.min(state.csvAt, state.extrasAt) : state.csvAt);
const currentSync = () => C.syncStatus({ online: navigator.onLine !== false, syncing: state.syncing, error: state.syncError, lastSyncAt: syncedAt(), now: Date.now() });

function updateSyncUi() {
  const dot = $('#sync-dot'), btn = $('#sync-btn');
  if (dot) { const st = currentSync(); dot.dataset.state = st.state; dot.setAttribute('aria-label', 'Sincronización: ' + st.label); dot.title = st.label; }
  if (btn) { btn.classList.toggle('spin', state.syncing); btn.disabled = state.syncing; }
}
window.addEventListener('online', updateSyncUi);
window.addEventListener('offline', updateSyncUi);

function vCollection() {
  const root = h('div');
  const q = h('input', { type: 'search', placeholder: 'Buscar artista o álbum', value: state.search, 'aria-label': 'Buscar', autocomplete: 'off' });
  const tags = C.allTags(state.collection);
  const sel = h('select', { 'aria-label': 'Filtrar por estilo' }, h('option', { value: '' }, 'Todos los estilos'), tags.map(t => h('option', { value: t }, t)));
  sel.value = tags.includes(state.tag) ? state.tag : '';
  state.tag = sel.value;
  const dot = h('button', { class: 'sync-dot', id: 'sync-dot', type: 'button', onclick: () => { const st = currentSync(); toast(`${st.label}. ${st.detail}`, st.state === 'error'); } });
  const syncBtn = h('button', { class: 'iconbtn', id: 'sync-btn', type: 'button', 'aria-label': 'Sincronizar ahora', title: 'Sincronizar ahora', onclick: syncAll }, icon(SYNC_ICON));
  root.append(q,
    h('div', { class: 'filters' }, sel, h('div', { class: 'syncgroup' }, dot, syncBtn)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: openRandom }, 'Disco aleatorio'),
      fb.isOwner() ? h('button', { class: 'btn sec', onclick: openAdd }, '+ Añadir disco') : null));
  const wall = h('div'), counter = h('div', { class: 'counter' });
  const paint = () => {
    const items = C.filterWall(state.collection, state.search, state.tag);
    wall.replaceChildren(items.length ? h('div', { class: 'wall' }, items.map(tileEl)) : h('p', { class: 'empty' }, 'No hay coincidencias.'));
    counter.textContent = `${state.collection.length} vinilos en la colección`;
  };
  q.addEventListener('input', () => { state.search = q.value; paint(); });
  sel.addEventListener('change', () => { state.tag = sel.value; paint(); });
  root.append(wall, counter);
  paint();
  queueMicrotask(updateSyncUi);
  return root;
}

function showPanel(...kids) {
  if (state.scanStop) state.scanStop();
  const sheet = $('#sheet');
  sheet.replaceChildren(h('div', { class: 'panel', role: 'dialog' }, ...kids));
  sheet.hidden = false;
  sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
}

function openRandom() {
  if (!state.collection.length) return toast('Todavía no hay discos en la colección', true);
  const r = state.collection[Math.floor(Math.random() * state.collection.length)];
  const link = safeUrl(r.url);
  const art = h('div', { class: 'randcover' }, coverEl(r));
  showPanel(h('div', { style: 'text-align:center' }, h('h2', null, r.name), h('p', { class: 'muted' }, r.artist),
    link !== '#' ? h('a', { href: link, target: '_blank', rel: 'noopener' }, art) : art),
    h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: openRandom }, 'Otro disco'),
      h('button', { class: 'btn sec', onclick: closeSheet }, 'Cerrar')));
}

// Solo el dueño: al pegar un enlace de Spotify, oEmbed (público) da nombre y portada e iTunes sugiere artista, año y estilo
function openAdd() {
  let add = null;     // { spotify, image, year }
  const link = h('input', { type: 'url', inputmode: 'url', placeholder: 'Pega aquí el enlace (Compartir → Copiar enlace)', autocomplete: 'off', autocapitalize: 'none' });
  const name = h('input', { type: 'text', maxlength: '120', autocomplete: 'off' });
  const artist = h('input', { type: 'text', maxlength: '80', list: 'artist-list', autocomplete: 'off' });
  const tags = h('input', { type: 'text', autocomplete: 'off', placeholder: 'rap, trap' });
  const list = h('datalist', { id: 'artist-list' }, [...new Set(state.collection.map(a => a.artist))].sort((x, y) => x.localeCompare(y, 'es')).map(a => h('option', { value: a })));
  const preview = h('div', { class: 'head', hidden: true });
  const suggest = h('div', { class: 'suggest' });
  const status = h('p', { class: 'muted', role: 'status' });
  const save = h('button', { class: 'btn', disabled: true }, 'Guardar disco');
  const say = (m, err) => { status.textContent = m || ''; status.className = 'muted' + (err ? ' bad' : ''); };
  const chips = h('div', { class: 'chips' }, C.allTags(state.collection).map(t => h('button', { class: 'chip', type: 'button', onclick: () => {
    tags.value = C.normalizeTags(tags.value + ',' + t).join(', ');
  } }, t)));

  link.addEventListener('input', async () => {
    const sp = C.parseSpotifyAlbum(link.value);
    add = null; save.disabled = true; preview.hidden = true; suggest.replaceChildren();
    if (!sp) return say(link.value.trim() ? 'Eso no parece un enlace de álbum de Spotify.' : '', !!link.value.trim());
    if (state.collection.some(a => a.id === sp.id || (a.url && a.url.includes(sp.id)))) return say('Ese disco ya está en tu colección.', true);
    say('Buscando el álbum…');
    try {
      const res = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(sp.url));
      if (!res.ok) throw new Error('Spotify respondió ' + res.status);
      const info = await res.json();
      if (!link.value.includes(sp.id)) return;          // el enlace cambió mientras buscaba
      add = { spotify: sp, image: info.thumbnail_url, year: null };
      preview.replaceChildren(h('img', { class: 'cover', src: safeUrl(info.thumbnail_url), alt: '', referrerpolicy: 'no-referrer', style: 'width:84px;height:84px' }), h('b', null, info.title));
      preview.hidden = false; name.value = info.title || ''; save.disabled = false;
      say('Elige o escribe el artista y los estilos, y guarda.');
      itunes(info.title);
    } catch (e) { say('No se pudo leer el álbum de Spotify: ' + e.message, true); }
  });

  async function itunes(title) {
    try {
      const res = await fetch('https://itunes.apple.com/search?entity=album&limit=5&country=ES&term=' + encodeURIComponent(title));
      const found = (await res.json()).results || [];
      suggest.replaceChildren(...found.map(r => h('button', { class: 'sug', type: 'button', onclick: () => {
        artist.value = r.artistName;
        if (r.primaryGenreName && !tags.value) tags.value = r.primaryGenreName.toLowerCase();
        if (add) add.year = (r.releaseDate || '').slice(0, 4);
      } }, r.artistName, h('small', null, `${r.collectionName} · ${(r.releaseDate || '').slice(0, 4)} · ${r.primaryGenreName || ''}`))));
    } catch (e) { /* las sugerencias son opcionales */ }
  }

  save.addEventListener('click', async () => {
    if (!add) return;
    const r = C.newAlbum({ spotifyUrl: add.spotify.url, name: name.value, artist: artist.value, image: add.image, tags: tags.value, year: add.year });
    if (!r.ok) return say(r.error, true);
    save.disabled = true; say('Guardando…');
    try {
      const out = await fb.addAlbum(r.album);
      state.extras = out.albums; state.extrasAt = out.at; rebuildCollection();
      closeSheet(); toast('Disco añadido: ' + r.album.name); render();
    } catch (e) { say('No se pudo guardar: ' + e.message, true); save.disabled = false; }
  });

  showPanel(h('h2', null, 'Añadir disco'),
    h('label', null, 'Enlace del álbum en Spotify'), link, preview,
    h('label', null, 'Nombre del álbum'), name,
    h('label', null, 'Artista'), artist, list, suggest,
    h('label', null, 'Estilos (separados por comas)'), tags, chips, status,
    h('div', { class: 'btns' }, save, h('button', { class: 'btn sec', onclick: closeSheet }, 'Cancelar')));
}

// Vuelve a leer el CSV de mi-app y, con sesión, los discos añadidos en la nube
async function syncAll() {
  if (state.syncing) return;
  state.syncing = true; state.syncError = ''; updateSyncUi();
  try {
    state.base = await collection.loadBase({ force: true });
    state.csvAt = await collection.csvAt();
    if (fb.isLoggedIn()) { const r = await fb.readExtras({ force: true }); state.extras = r.albums; state.extrasAt = r.at; }
    rebuildCollection();
    toast('Colección sincronizada');
  } catch (e) { state.syncError = e.message; toast(e.message, true); }
  finally { state.syncing = false; if (state.tab === 'coleccion' || state.tab === 'ajustes') render(); else updateSyncUi(); }
}
const syncExtras = syncAll;

// ---------- Comprar (sugeridos · deseos · comprados) ----------
const BUY_VIEWS = [['sugeridos', 'Sugeridos'], ['deseos', 'Deseos'], ['comprados', 'Comprados']];

function vBuy() {
  const root = h('div');
  const nWish = state.wish.filter(w => w.status === 'wanted').length, nBought = state.wish.filter(w => w.status === 'bought').length;
  const labels = { sugeridos: 'Sugeridos', deseos: 'Deseos' + (nWish ? ` (${nWish})` : ''), comprados: 'Comprados' + (nBought ? ` (${nBought})` : '') };
  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' }, BUY_VIEWS.map(([k]) =>
    h('button', { 'aria-pressed': String(state.buyView === k), onclick: () => { state.buyView = k; prefs.set('buyView', k); render(); } }, labels[k]))));
  if (state.buyView === 'deseos') { root.append(wv.wishView(wishCtx)); return root; }
  if (state.buyView === 'comprados') { root.append(wv.boughtView(wishCtx)); return root; }

  const bought = W.boughtKeys(state.wish), wanted = W.wantedKeys(state.wish);
  const all = C.minArtistPlays(rankingList(), 2).filter(r => !r.owned && !bought.has(r.key));     // todos los artistas con más de 1 reproducción
  const missing = all.filter(r => !state.prices.has(r.key));
  if (missing.length && !state.peeking) {
    state.peeking = true;      // precios ya consultados antes (caché local): se pintan sin red
    Promise.all(missing.map(r => discogs.peek(r).then(v => { if (v) state.prices.set(r.key, v); return !!v; })))
      .then(found => { state.peeking = false; if (found.some(Boolean) && state.tab === 'comprar') render(); });
  }
  const withPrice = r => C.estimate({ discogs: state.prices.get(r.key) }, r.offers) != null;
  const filters = {
    todos: () => true, precio: withPrice,
    stock: r => r.offers.some(o => o.available), preventa: r => r.offers.some(o => o.preorder)
  };
  const list = all.filter(filters[state.filter]);

  if (!all.length) {
    root.append(h('div', { class: 'empty' }, 'Cuando haya ranking, aquí verás lo que escuchas y todavía no tienes en vinilo.'));
    return root;
  }
  root.append(h('p', { class: 'muted' }, 'Lo que escuchas (artistas con más de 1 reproducción) y aún no tienes en vinilo (sin lo que ya marcaste como comprado). Toca un disco para ver dónde comprarlo o apuntarlo.'));
  root.append(h('div', { class: 'chips' }, [['todos', 'Todos'], ['precio', 'Con precio'], ['stock', 'En stock'], ['preventa', 'Preventa']]
    .map(([k, label]) => h('button', { class: 'chip', 'aria-pressed': String(state.filter === k), onclick: () => { state.filter = k; render(); } }, label))));
  root.append(list.length ? h('ul', { class: 'list' }, list.map((r, i) => albumRow({ ...r, wished: wanted.has(r.key) }, i))) : h('div', { class: 'empty' }, 'Nada con este filtro.'));
  return root;
}

// ---------- Conciertos ----------
function vConcerts() { return concertsView({ state, onSettings: () => go('ajustes') }); }

// ---------- Deseos: contexto para las pantallas, guardado y avisos ----------
const saveWish = () => { scheduleCloud('wish'); return store.set('wishlist', state.wish); };

// ---------- Copia en la nube (Firestore de mi-app; solo el dueño) ----------
const cloudSource = { wish: () => state.wish, live: () => state.live, history: () => ({ history: state.history, info: state.historyInfo, stats: state.stats }), prefs: () => cloud.collectPrefs() };
const dirty = new Set();
let cloudTimer;
function scheduleCloud(...keys) {
  if (!cloud.available()) return;
  keys.forEach(k => dirty.add(k)); dirty.add('prefs');
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(cloudPush, 5000);
}
async function cloudPush({ all = false } = {}) {
  if (!cloud.available() || state.cloudBusy) return;
  state.cloudBusy = true; state.cloudError = '';
  const keys = all ? cloud.KEYS : [...dirty]; dirty.clear();
  try {
    for (const k of keys) {
      const data = cloudSource[k]();
      if (k === 'history' && !state.stats && !Object.keys(state.history).length) continue;      // nada que subir
      if (k === 'live' && !state.live.entries.length) continue;
      await cloud.pushKey(k, data);
    }
    state.cloudAt = Date.now();
  } catch (e) { state.cloudError = e.message; keys.forEach(k => dirty.add(k)); }
  finally { state.cloudBusy = false; refreshCloudCard(); }
}

// Baja lo que haya en la nube y lo junta con lo local (en un móvil nuevo recupera todo). Luego sube lo que falte.
async function cloudPull() {
  if (!cloud.available() || state.cloudBusy) return;
  state.cloudBusy = true; state.cloudError = '';
  try {
    const w = await cloud.pullKey('wish');
    if (w) { state.wish = cloud.mergeWish(state.wish, w.data); await store.set('wishlist', state.wish); }
    const lv = await cloud.pullKey('live');
    if (lv && lv.data && Array.isArray(lv.data.entries)) {
      state.live = { ...L.mergeLive(state.live, lv.data.entries, state.stats ? state.stats.total.lastTs : 0).live, at: state.live.at }; await store.set('live', state.live);
    }
    const hi = await cloud.pullKey('history');
    if (hi && hi.at > cloud.localAt('history') && hi.data && hi.data.stats && !dirty.has('history')) {      // lo local sin subir manda
      const d = hi.data;
      state.history = C.rekeyHistory(d.history || {}); state.historyInfo = d.info || null; state.stats = d.stats;
      await store.set('history', state.history); await store.set('historyInfo', state.historyInfo); await store.set('stats', state.stats);
      state.live = L.pruneLive(state.live, state.stats.total.lastTs); await store.set('live', state.live);
    }
    const pf = await cloud.pullKey('prefs');
    if (pf && pf.data) for (const [k, v] of Object.entries(pf.data)) if (cloud.PREF_KEYS.includes(k) && prefs.get(k, '') === '') prefs.set(k, v);
    recompute(); updateBadge();
    state.cloudBusy = false;
    await cloudPush({ all: true });                 // sube lo local que la nube no tenga
    state.cloudAt = Date.now();
    if (state.tab !== 'ajustes') render();           // en Ajustes no se repinta (se perdería el archivo elegido): solo la tarjeta
  } catch (e) { state.cloudError = e.message; }
  finally { state.cloudBusy = false; refreshCloudCard(); }
}
const wishCtx = {
  state, toast, showPanel, coverEl, saveWish,
  closeSheet: () => closeSheet(),
  render: () => render(),
  refreshWish: () => { updateBadge(); if (state.tab === 'comprar') render(); }
};

// Insignia en la pestaña Comprar: cuántos deseos están disponibles ahora
function updateBadge() {
  const n = state.wish.filter(w => w.status === 'wanted' && ((w.notified && w.notified.length) || false)).length;
  const b = document.querySelector('.tabs [data-tab=comprar]');
  if (!b) return;
  let dot = b.querySelector('.badge');
  if (!n) { if (dot) dot.remove(); return; }
  if (!dot) { dot = document.createElement('i'); dot.className = 'badge'; b.append(dot); }
  dot.textContent = String(n);
}

function notifyAlerts(alerts) {
  const texts = alerts.map(W.alertText);
  toast((texts.length === 1 ? '¡Disponible! ' : `¡${texts.length} deseos disponibles! `) + texts.slice(0, 2).join(' · '));
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title = texts.length === 1 ? '¡Ya disponible!' : `${texts.length} vinilos disponibles`;
  const body = texts.join('\n');
  const show = reg => reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'vt-wish' });
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(show).catch(() => { try { new Notification(title, { body }); } catch (e) { /* sin notificaciones */ } });
}

// Mira tiendas (al instante) y Discogs (los deseos que llevan 6 h sin consultarse, de uno en uno). Avisa de lo nuevo.
async function wishCheck() {
  if (state.wishBusy || !state.wish.some(w => w.status === 'wanted')) { updateBadge(); return; }
  state.wishBusy = true;
  try {
    let r = W.checkAll(state.wish, { storeIndex: state.storeIndex });
    const dgMap = {};
    if (discogs.hasToken() && navigator.onLine !== false) {
      const stale = r.list.filter(w => W.needsDiscogs(w)).slice(0, 6);
      for (const w of stale) {
        try { dgMap[w.id] = w.kind === 'release' && w.discogsId ? await discogs.releaseStats(w.discogsId, config.currency)
          : await discogs.lookup({ ...w, key: C.albumKey(w.artist, w.name) }, config.currency).then(v => ({ forSale: v.none ? 0 : (v.forSale || 0), lowest: v.none ? null : v.lowest, at: Date.now() })); }
        catch (e) { break; }        // límite o token: se reintenta más tarde
      }
    }
    const r2 = Object.keys(dgMap).length ? W.checkAll(state.wish, { storeIndex: state.storeIndex, dgMap }) : r;
    state.wish = r2.list;
    await saveWish();
    const alerts = [...new Map([...r.alerts, ...r2.alerts].map(a => [a.item.id, a])).values()];
    if (alerts.length) notifyAlerts(alerts);
    updateBadge();
    if (state.tab === 'comprar') render();
  } finally { state.wishBusy = false; }
}

// ---------- Ficha de álbum ----------
function closeSheet() {
  if (state.scanStop) state.scanStop();      // apaga la cámara si el lector estaba abierto
  $('#sheet').hidden = true; $('#sheet').replaceChildren();
}

async function openSheet(r) {
  const sheet = $('#sheet');
  const body = h('div');
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': r.name }, body);
  sheet.replaceChildren(panel); sheet.hidden = false;
  sheet.onclick = e => { if (e.target === sheet) closeSheet(); };

  const put = (...kids) => body.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  const paint = () => {
    const d = state.prices.get(r.key);
    const offers = r.offers || [];
    const spotifyLink = r.id ? `https://open.spotify.com/album/${r.id}` : r.url;
    put(
      h('div', { class: 'head' }, coverEl(r), h('div', null, h('h2', null, r.name), h('p', { class: 'muted' }, r.artist),
        r.owned ? h('span', { class: 'chip ok' }, '✓ En tu colección') : h('span', { class: 'chip' }, 'No lo tienes'))),
      r.minutes ? h('div', { class: 'card' }, h('div', { class: 'stat' }, h('span', null, 'Escuchado'), h('b', null, `${Math.round(r.minutes)} min · ${r.plays} reprod.`))) : null,
      !r.owned ? h('div', { class: 'card' }, h('h3', null, 'Dónde comprarlo en vinilo'),
        offers.length ? offers.map(o => h('div', { class: 'offer' },
          h('div', null, h('b', null, o.store), h('small', null, o.title + (o.preorder ? ' · preventa' + (o.release ? ' ' + o.release : '') : ''))),
          h('div', { style: 'text-align:right' }, h('b', null, C.money(o.price)), h('small', { class: o.available || o.preorder ? 'own' : 'muted' },
            o.preorder ? 'Preventa' : o.available ? 'En stock' : 'Agotado'), h('a', { href: safeUrl(o.url), target: '_blank', rel: 'noopener' }, 'Abrir'))))
          : h('p', { class: 'muted' }, state.storeIndex.length ? 'No aparece en Universal Music Online ni en Apparell.' : 'Aún no hay datos de tiendas.'),
        h('div', { class: 'offer' }, h('div', null, h('b', null, 'Fnac'), h('small', null, 'Bloquea consultas automáticas: búscalo a mano')),
          h('a', { href: C.fnacUrl(r), target: '_blank', rel: 'noopener' }, 'Buscar'))) : null,
      !r.owned ? h('div', { class: 'card' }, h('h3', null, 'Discogs (mercado)'),
        d && !d.none ? [
          h('div', { class: 'stat' }, h('span', null, 'Copia más barata'), h('b', null, C.money(d.lowest))),
          h('div', { class: 'stat' }, h('span', null, 'A la venta'), h('b', null, d.forSale ?? '—')),
          h('div', { class: 'stat' }, h('span', null, 'La tienen / la quieren'), h('span', null, `${d.have ?? '—'} / ${d.want ?? '—'}`)),
          h('a', { href: safeUrl(d.url), target: '_blank', rel: 'noopener' }, 'Ver en Discogs')]
          : d && d.none ? h('p', { class: 'muted' }, 'No hay edición en vinilo en Discogs.')
            : h('button', { class: 'btn sec', id: 'dlook' }, 'Consultar precio')) : null,
      !r.owned ? wv.wishButtons(wishCtx, r, paint) : null,
      h('div', { class: 'btns' }, spotifyLink && spotifyLink !== '#' ? h('a', { class: 'btn sec', href: safeUrl(spotifyLink), target: '_blank', rel: 'noopener' }, 'Abrir en Spotify') : null,
        h('button', { class: 'btn sec', onclick: closeSheet }, 'Cerrar')));
    const btn = body.querySelector('#dlook');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Consultando…';
      try { state.prices.set(r.key, await discogs.lookup(r, config.currency)); } catch (e) { toast(e.message, true); }
      paint(); if (state.tab === 'comprar') render();
    });
  };
  const cached = await discogs.peek(r);
  if (cached) state.prices.set(r.key, cached);
  paint();
}

// ---------- Ajustes ----------
// Tarjeta «Copia en la nube» de Ajustes
function cloudCard() {
  return h('div', { class: 'card', id: 'cloud-card' }, h('h3', null, 'Copia en la nube'),
    cloud.available()
      ? [h('p', { class: 'muted' }, 'Tu lista de deseos y comprados, el registro en vivo, el historial importado y los ajustes se guardan en tu Firebase de mi-app. Así sobreviven a borrar la app: al iniciar sesión se recuperan solos. Los tokens y claves (Spotify, Discogs, Ticketmaster) NO se suben.'),
        state.cloudError ? h('p', { class: 'muted bad' }, state.cloudError) : h('p', { class: 'own' }, state.cloudBusy ? 'Sincronizando…' : state.cloudAt ? '✓ Sincronizado ' + when(state.cloudAt) : 'Pendiente de sincronizar'),
        state.cloudError && /403/.test(state.cloudError) ? h('p', { class: 'muted' }, 'Falta una regla en Firestore (consola de Firebase → Firestore → Reglas): permite leer y escribir en /vinilos/{doc} a tu UID de dueño, como ya haces con vinilos/coleccion.') : null,
        h('div', { class: 'btns' }, h('button', { class: 'btn sec', disabled: state.cloudBusy, onclick: () => cloudPull() }, 'Sincronizar ahora'))]
      : h('p', { class: 'muted' }, 'Solo la cuenta del dueño puede guardar la copia en la nube.'));
}
function refreshCloudCard() { const c = $('#cloud-card'); if (c) c.replaceWith(cloudCard()); }

function field(label, input) { return h('div', null, h('label', null, label), input); }

function vSettings() {
  const root = h('div');

  // Cuenta de mi-app
  const u = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', placeholder: 'usuario', value: fb.user() || '' });
  const p = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'contraseña' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Cuenta de mi-app'),
    h('p', { class: 'muted' }, 'La misma cuenta de tu app Vinilos. Sirve para leer los discos que añades desde allí. La contraseña no se guarda.'),
    fb.isLoggedIn()
      ? [h('p', null, 'Sesión iniciada como ', h('b', null, fb.user()), fb.isOwner() ? ' (dueño: puedes añadir discos)' : ''),
        h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: syncExtras }, 'Sincronizar ahora'),
          h('button', { class: 'btn danger', onclick: () => { fb.logout(); state.extras = []; rebuildCollection(); render(); } }, 'Cerrar sesión'))]
      : [field('Usuario', u), field('Contraseña', p),
        h('button', { class: 'btn', onclick: async e => {
          e.target.disabled = true;
          try { await fb.login(u.value, p.value); await syncExtras(); cloudPull(); } catch (err) { toast(err.message, true); }
          render();
        } }, 'Iniciar sesión')]));

  if (fb.isLoggedIn()) root.append(cloudCard());

  // Spotify
  const cid = h('input', { type: 'text', value: spotify.clientId(), autocapitalize: 'none', 'aria-label': 'Client ID' });
  const paste = h('input', { type: 'url', placeholder: 'https://…/?code=…&state=…', autocapitalize: 'none' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Spotify'),
    spotify.isConnected() ? h('p', { class: 'own' }, '✓ Conectado · última carga: ' + when(state.apiAt)) : h('p', { class: 'muted' }, 'Sin conectar.'),
    spotify.isConnected() ? h('p', { class: 'muted' }, `En vivo: ${state.live.entries.length} reproducciones guardadas` +
      (state.live.entries.length ? ` desde ${when(Date.parse(state.live.entries[0].ts))}` : '') +
      '. Se actualiza sola cada minuto mientras la app está abierta. Spotify solo recuerda tus últimas 50 canciones: abre la app de vez en cuando para no perder ninguna.') : null,
    field('Client ID (app de developer.spotify.com)', cid),
    h('p', { class: 'muted' }, 'Redirect URI que debes tener añadida en tu app de Spotify:'),
    h('code', { style: 'word-break:break-all;font-size:.8rem;user-select:text;-webkit-user-select:text' }, spotify.redirectUri()),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: async () => {
      try { await navigator.clipboard.writeText(spotify.redirectUri()); toast('Copiada: pégala en Redirect URIs de Spotify'); }
      catch (e) { toast('No se pudo copiar: selecciónala a mano', true); }
    } }, 'Copiar redirect URI')),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: async () => { prefs.set('spotify.client', cid.value.trim()); await spotify.startLogin(); } },
        spotify.isConnected() ? 'Reconectar' : 'Conectar Spotify'),
      spotify.isConnected() ? h('button', { class: 'btn sec', onclick: refreshApi }, 'Actualizar datos') : null,
      spotify.isConnected() ? h('button', { class: 'btn danger', onclick: () => { spotify.disconnect(); state.now = undefined; render(); } }, 'Desconectar') : null,
      state.live.entries.length ? h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('¿Borrar el registro en vivo guardado en este dispositivo?')) return;
        state.live = L.emptyLive(); await store.set('live', state.live); recompute(); render();
      } }, 'Borrar registro en vivo') : null),
    h('details', null, h('summary', { class: 'muted' }, 'Si Spotify se queda en bucle y no me deja aceptar'),
      h('p', { class: 'muted' }, 'En la app instalada, el login de Spotify a veces no guarda la sesión. Hazlo en Safari: 1) pulsa el botón y copia el enlace; 2) abre Safari (no la app), pega el enlace y entra con tu cuenta; 3) acepta; 4) copia la dirección a la que te lleve y pégala abajo, en "Si al volver…".'),
      (() => {
        const box = h('textarea', { readonly: true, rows: '5', hidden: true, style: 'width:100%;font-size:12px;user-select:text;-webkit-user-select:text' });
        const copy = h('button', { class: 'btn sec', hidden: true, onclick: async () => {
          box.select();
          try { await navigator.clipboard.writeText(box.value); toast('Enlace copiado: pégalo en Safari'); } catch (e) { toast('Mantén pulsado el cuadro y elige Copiar', true); }
        } }, 'Copiar enlace');
        const make = h('button', { class: 'btn', onclick: async () => {
          prefs.set('spotify.client', cid.value.trim());
          box.value = await spotify.buildLoginUrl(); box.hidden = false; copy.hidden = false;
        } }, 'Conseguir enlace para Safari');
        return h('div', null, h('div', { class: 'btns' }, make, copy), box);
      })()),
    h('details', null, h('summary', { class: 'muted' }, 'Si al volver de Spotify no entra solo'),
      h('p', { class: 'muted' }, 'Copia la URL completa de la barra de direcciones tras aceptar y pégala aquí.'),
      paste, h('button', { class: 'btn sec', onclick: async () => {
        try { await spotify.finishLogin(paste.value); toast('Spotify conectado'); await refreshApi(); } catch (e) { toast(e.message, true); }
      } }, 'Completar conexión'))));

  // Historial
  const file = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', multiple: true });
  const info = state.historyInfo;
  root.append(h('div', { class: 'card' }, h('h3', null, 'Historial de Spotify (minutos reales)'),
    h('p', { class: 'muted' }, 'spotify.com/account/privacy → "Historial de reproducciones ampliado". Importa el .zip tal cual (o todos los .json a la vez; una nueva importación sustituye a la anterior). Sirven los dos paquetes: el ampliado (con álbumes, tarda más) y el básico "Datos de la cuenta" (último año, sin álbumes, llega antes). Se procesa en tu móvil, no se sube a ningún sitio.'),
    info ? h('p', null, `${info.basic ? 'paquete básico (sin álbumes)' : info.albums + ' álbumes'} · ${info.plays} reproducciones · ${info.from} → ${info.to}`) : null,
    file, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => importHistory(file.files) }, 'Importar'),
      info ? h('button', { class: 'btn danger', onclick: async () => { await store.del('history'); await store.del('historyInfo'); await store.del('stats'); state.history = {}; state.historyInfo = null; state.stats = null; recompute(); render(); } }, 'Borrar historial') : null)));

  // Discogs
  const du = h('input', { type: 'text', value: prefs.get('discogs.user'), autocapitalize: 'none', placeholder: 'usuario de Discogs' });
  const dt = h('input', { type: 'password', value: prefs.get('discogs.token'), autocomplete: 'off', placeholder: 'token personal' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Discogs'),
    h('p', { class: 'muted' }, 'discogs.com/settings/developers → Generate new token. Con token las consultas son más rápidas. Se guarda solo en este dispositivo.'),
    field('Usuario', du), field('Token', dt),
    h('button', { class: 'btn', onclick: () => { prefs.set('discogs.user', du.value.trim()); prefs.set('discogs.token', dt.value.trim()); toast('Guardado'); } }, 'Guardar')));

  // Tema
  const theme = h('select', { 'aria-label': 'Tema' }, [['', 'Automático (del sistema)'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => h('option', { value: v }, l)));
  theme.value = prefs.get('theme');
  theme.addEventListener('change', () => { prefs.set('theme', theme.value); applyTheme(theme.value); });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Tema'), theme));

  // Datos
  root.append(h('div', { class: 'card' }, h('h3', null, 'Datos'),
    h('p', { class: 'muted' }, `VinylTracker ${VERSION}. Todo se guarda en este dispositivo. Tiendas: Universal Music Online y Apparell (actualizadas a diario); Fnac no permite consultas automáticas.`),
    h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm('¿Borrar todos los datos de VinylTracker de este dispositivo?')) return;
      await store.clearAll();
      Object.keys(localStorage).filter(k => k.startsWith('vt.')).forEach(k => localStorage.removeItem(k));
      location.reload();
    } }, 'Borrar todo')));
  return root;
}

async function importHistory(files) {
  if (!files || !files.length) return toast('Elige el .zip o los .json del export', true);
  try {
    setStatus('Importando…');
    let entries = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) entries.push(...await readSpotifyZip(await f.arrayBuffer()));
      else { const j = JSON.parse(await f.text()); if (Array.isArray(j)) entries.push(...j); }
    }
    entries = C.normalizeEntries(entries);      // el paquete básico ("Datos de la cuenta") se adapta al ampliado
    setStatus('Calculando estadísticas…');
    await new Promise(r => setTimeout(r, 30));          // deja pintar el aviso antes del cálculo
    const stats = buildStats(entries);
    if (!stats.total.rows) throw new Error('No encontré reproducciones de música en esos archivos. Elige el .zip de Spotify tal cual o sus .json (StreamingHistory…).');
    // Álbumes: solo el historial ampliado los trae; el básico da artistas, canciones y estadísticas
    const { into, used, skipped } = C.aggregateHistory(entries, {});
    const info = { albums: Object.keys(into).length, plays: stats.total.plays, from: stats.total.first, to: stats.total.last, skipped, basic: !Object.keys(into).length };
    await store.set('history', into); await store.set('historyInfo', info); await store.set('stats', stats);
    state.history = into; state.historyInfo = info; state.stats = stats;
    state.live = L.pruneLive(state.live, stats.total.lastTs); await store.set('live', state.live); recompute();
    scheduleCloud('history', 'live');
    toast(info.basic ? `Importado: ${S_fmt(stats.total.plays)} reproducciones (sin álbumes: es el paquete básico)` : `Historial importado: ${info.albums} álbumes`);
    if (info.basic && state.rankView === 'albums') { state.rankView = 'stats'; prefs.set('rankView', 'stats'); }
    go('ranking');
  } catch (e) { toast(e.message, true); setStatus(''); }
}
const S_fmt = n => new Intl.NumberFormat('es-ES').format(n);

async function refreshApi() {
  try {
    const albums = await spotify.loadApiAlbums(m => setStatus(m));
    state.apiAlbums = albums; state.apiAt = Date.now();
    await store.set('api', { at: state.apiAt, albums });
    toast(`Spotify: ${Object.keys(albums).length} álbumes`);
    go('ranking');
    liveRefresh(); nowRefresh();
  } catch (e) { toast(e.message, true); setStatus(''); }
}

// ---------- arranque ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await loadAll();
  markTab();
  render();
  updateBadge();
  wishCheck();
  cloudPull();
  setInterval(() => { if (document.visibilityState === 'visible') wishCheck(); }, 30 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wishCheck(); });
  startLive();
  // Vuelta del login de Spotify: ?code=…&state=…
  const qs = new URLSearchParams(location.search);
  if (qs.has('code') || qs.has('error')) {
    const full = location.href;
    try {
      await spotify.finishLogin(qs.toString());
      history.replaceState(null, '', location.pathname);       // solo se limpia la dirección si todo ha ido bien
      toast('Spotify conectado'); await refreshApi();
    } catch (e) { showLanding(full, e.message); }
  } else if (fb.isLoggedIn()) {
    fb.readExtras().then(r => { if (!r.fromCache) { state.extras = r.albums; state.extrasAt = r.at; rebuildCollection(); render(); } })
      .catch(e => { state.syncError = e.message; updateSyncUi(); });
  }
}

// Pantalla de "casi listo": se enseña cuando Spotify vuelve a una ventana que no puede completar la conexión
// (típico en iPhone: vuelve a Safari en vez de a la app instalada). La dirección se conserva para copiarla.
function showLanding(url, reason) {
  const box = h('textarea', { readonly: true, rows: '5', style: 'width:100%;font-size:12px;user-select:text;-webkit-user-select:text' });
  box.value = url;
  view.replaceChildren(h('div', null,
    h('div', { class: 'card' }, h('h3', null, 'Casi listo: falta un paso'),
      h('p', null, reason),
      h('p', null, 'Copia esta dirección completa y pégala en la app instalada: ',
        h('b', null, 'Ajustes → Spotify → "Si al volver de Spotify no entra solo"'), '.'),
      box,
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => {
          box.select();
          try { await navigator.clipboard.writeText(url); toast('Dirección copiada'); } catch (e) { toast('Mantén pulsado el cuadro y elige Copiar', true); }
        } }, 'Copiar dirección'),
        h('button', { class: 'btn sec', onclick: () => { history.replaceState(null, '', location.pathname); go('ajustes'); } }, 'Ir a Ajustes')))));
  setStatus('');
}
boot();
