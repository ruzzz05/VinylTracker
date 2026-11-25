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
import { artistsView, tracksView, statsPage } from './statsview.js';
import { artistAvatar } from './artists.js';
import * as W from './wishlist.js';
import * as addview from './addview.js';
import { rediscoverView, preload as preloadRediscover } from './rediscoverview.js';
import * as addinfo from './albuminfo.js';
import * as cloud from './cloud.js';
import * as wv from './wishview.js';
import { concertsView } from './concertsview.js';
import { trackCover, albumCover, knownCovers } from './covers.js';
import * as imgcache from './imgcache.js';
import * as T from './tint.js';

const VERSION = '1.16.0';
// Oscuro por defecto (es el diseño Tinta); «auto» sigue al sistema
const applyTheme = v => { if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v === 'light' ? 'light' : 'dark'; };
applyTheme(prefs.get('theme'));
// iOS (app instalada): al abrirla, el alto del documento a veces sale ~59 px más corto que la pantalla
// (el de la barra de estado) y la barra inferior se queda flotando con un hueco debajo.
// Se usa el alto real de la pantalla para el fondo; el menú se mantiene dentro de la ventana visible. En el navegador normal no se toca nada.
const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function fixAppHeight() {
  if (!isStandalone()) return;
  if (Math.abs(innerWidth - screen.width) > 1 && Math.abs(innerWidth - screen.height) > 1) return;   // ventana más pequeña que la pantalla (iPad con pantalla dividida): no tocar
  const landscape = window.matchMedia && matchMedia('(orientation: landscape)').matches;
  const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  if (full > 0) document.documentElement.style.setProperty('--app-h', full + 'px');
  // iOS no pinta fuera de la ventana real (innerHeight): si la pantalla es más alta, el menú se sube esa diferencia para que nunca quede cortado
  const gap = Math.max(0, full - innerHeight);
  document.documentElement.style.setProperty('--dock-gap', (gap > 8 ? gap : 0) + 'px');
}
fixAppHeight();
for (const ev of ['resize', 'orientationchange', 'pageshow']) window.addEventListener(ev, fixAppHeight);
document.addEventListener('visibilitychange', fixAppHeight);   // iOS vuelve a descuadrarlo al reabrir la app
setTimeout(fixAppHeight, 300); setTimeout(fixAppHeight, 1200);

const $ = s => document.querySelector(s);
const view = $('#view');
// Sin zoom: iOS ignora a veces user-scalable=no, así que se bloquean también los gestos de pellizco.
// (Con el zoom permitido, iOS puede encoger la ventana de la app instalada y el menú inferior queda tapado por una banda.)
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
  base: [], extras: [], extrasBad: [], extrasLost: [], extrasAt: 0, owned: null, collection: [],
  storeIndex: [], storeDate: '',
  stats: null, rankView: prefs.get('rankView', 'albums') === 'stats' ? 'albums' : prefs.get('rankView', 'albums'),
  live: L.emptyLive(), liveStats: null, liveHistory: {}, effStats: null, effHistory: {},
  now: undefined, nowError: '', liveBusy: false, liveError: '',
  csvAt: 0, syncing: false, syncError: '',
  prices: new Map(),          // key -> { discogs }
  filter: 'todos', search: '', buyMonths: Number(prefs.get('buyMonths', '12')), buyShown: 40,
  vinyl: new Map(), vinylTried: new Set(), vinylRun: 0, vinylProgress: { running: false, done: 0, error: '' },
  priceProgress: { running: false, done: 0, total: 0, error: '' }, priceTried: new Set(), priceRun: 0, manual: [], cloudAt: 0, cloudError: '', cloudBusy: false, wish: [], buyView: prefs.get('buyView', 'sugeridos'), scanStop: null, wishBusy: false
};

// Lo que ven las pantallas es lo importado MÁS lo recogido en vivo
function recompute() {
  const entries = L.toEntries(state.live);
  state.liveStats = entries.length ? buildStats(entries) : null;
  state.liveHistory = entries.length ? C.aggregateHistory(entries, {}).into : {};
  state.effStats = mergeStats(state.stats, state.liveStats);
  state.effHistory = C.mergeHistory(state.history, state.liveHistory);
}

// Ranking: se calcula una sola vez mientras no cambien los datos, y las ofertas de tienda solo cuando alguien las pide
const rankMemo = new Map();      // periodo (meses) -> { key, list }
const offersCache = new WeakMap();
const offersFor = r => {
  let m = offersCache.get(state.storeIndex);
  if (!m) offersCache.set(state.storeIndex, m = new Map());
  let o = m.get(r.key);
  if (!o) m.set(r.key, o = C.matchStores(r, state.storeIndex));
  return o;
};
const rankingList = (months = state.months) => {
  const key = [state.effHistory, state.apiAlbums, state.owned, state.storeIndex];
  const memo = rankMemo.get(months);
  if (memo && key.every((v, i) => v === memo.key[i])) return memo.list;
  const list = C.buildRanking({ history: state.effHistory, api: state.apiAlbums, months }).map(r => {
    const o = { ...r, owned: C.isOwned(r, state.owned) };
    Object.defineProperty(o, 'offers', { enumerable: true, configurable: true, get: () => offersFor(r) });
    return o;
  });
  rankMemo.clear();            // solo se guarda un periodo a la vez (cada uno puede ser una lista de miles)
  rankMemo.set(months, { key, list });
  return list;
};

async function loadAll() {
  imgcache.preload().catch(() => {});
  preloadRediscover().catch(() => {});
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
  state.manual = await store.get('manual', []);
  const ex = await fb.cachedExtras();
  if (ex) { state.extras = ex.albums; state.extrasBad = ex.bad || []; state.extrasLost = ex.lost || []; state.extrasAt = ex.at; }
  state.csvAt = await collection.csvAt();
  rebuildCollection();
  try {
    const r = await fetch('data/stores.json');
    const d = await r.json();
    state.storeIndex = C.indexStores(d); state.storeDate = d.generated;
  } catch (e) { /* sin datos de tiendas todavía */ }
}

// Discos que estaban en la nube y ya no (otra app o dispositivo pisó la lista): se pueden restaurar
const applyExtras = r => { state.extras = r.albums; state.extrasBad = r.bad || []; state.extrasLost = r.lost || []; state.extrasAt = r.at; };
function lostCard() {
  const names = state.extrasLost.slice(0, 5).map(a => [a.name, a.artist].filter(Boolean).join(' · ')).join(', ') + (state.extrasLost.length > 5 ? '…' : '');
  const act = fn => async e => {
    e.target.disabled = true;
    try { applyExtras(await fn()); rebuildCollection(); toast('Hecho'); } catch (err) { toast(err.message, true); }
    render();
  };
  return h('div', { class: 'card', id: 'lost-card' },
    h('p', null, `⚠ Han desaparecido ${state.extrasLost.length} disco${state.extrasLost.length === 1 ? '' : 's'} de la nube: ${names}.`),
    h('p', { class: 'muted' }, 'Suele pasar si mi-app u otro dispositivo guarda con una lista antigua. Puedes recuperarlos.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: act(fb.restoreLost) }, 'Restaurar'),
      h('button', { class: 'btn sec', onclick: act(fb.acceptCurrent) }, 'Ignorar (los quité yo)')));
}

function rebuildCollection() {
  state.collection = collection.combine(state.base, state.extras.concat(state.manual));
  state.owned = C.ownedIndex(state.collection);
}

// ---------- navegación ----------
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function go(tab) {
  state.priceRun++; state.priceProgress.running = false; state.vinylRun++; state.vinylProgress.running = false;
  const changed = tab !== state.tab;
  state.tab = tab; prefs.set('tab', tab);
  markTab();
  view.scrollTop = 0;
  render({ enter: changed });
  view.scrollTop = 0;
}
function markTab() {
  document.querySelectorAll('[data-tab]').forEach(b => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));

// opts.enter: al cambiar de pestaña la pantalla se funde y las primeras filas entran escalonadas
// Repintados en segundo plano (llegan datos nuevos): se hacen directos, sin volver a enseñar el esqueleto
let quietRender = false;
const renderQuiet = () => { quietRender = true; try { render(); } finally { quietRender = false; } };
const tabCost = {};      // lo que tardó la última vez en construirse cada pestaña (ms)
let paintToken = 0;
function render(opts = {}) {
  const tab = state.tab;
  const paint = () => {
    const t0 = performance.now();
    view.replaceChildren(({ ranking: vRanking, stats: vStats, coleccion: vCollection, comprar: vBuy, conciertos: vConcerts, ajustes: vSettings })[tab]());
    tabCost[tab] = performance.now() - t0;
    setStatus('');
    if (opts.enter && !reduceMotion()) staggerIn();
    applyTint();
  };
  const token = ++paintToken;
  // Si la pestaña es pesada: primero sale al instante el esqueleto gris y el contenido se construye en el cuadro siguiente
  if (!quietRender && tab !== 'coleccion' && tab !== 'comprar' && tab !== 'ajustes' && (tabCost[tab] === undefined || tabCost[tab] > 40)) {
    view.replaceChildren(skeletonList(8));
    requestAnimationFrame(() => setTimeout(() => { if (token === paintToken && state.tab === tab) paint(); }, 0));
    return;
  }
  paint();
}

// Entrada escalonada: se marca #view solo durante un instante, para que los repintados normales no la repitan
let enterTimer;
function staggerIn() {
  const mark = sel => view.querySelectorAll(sel).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
  mark('.list > li'); mark('.wall > *'); mark('.cc-bars .cc-bar'); mark('.card, .tiles > *');
  view.querySelectorAll('.cc-bars').forEach(g => [...g.querySelectorAll('.cc-bar')].forEach((b, i) => b.style.setProperty('--i', i)));
  view.classList.add('enter');
  countUp(view.querySelector('.hero .big'));
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => view.classList.remove('enter'), 900);
}

// Cifras que suben hasta su valor (38 h 12 min: cada número se interpola desde 0)
function countUp(el, ms = 750) {
  if (!el || reduceMotion()) return;
  const text = el.textContent;
  if (!/\d/.test(text)) return;
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = p >= 1 ? text : text.replace(/\d+/g, m => String(Math.round(+m * e)));
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
    else if (el.isConnected) el.textContent = text;
  };
  requestAnimationFrame(step);
}

// ---------- Color de ambiente: cada pantalla toma el color dominante de la portada que la protagoniza ----------
function tintAlbum() {
  if (state.tab === 'ranking' && state.now) return { image: state.now.image, key: state.now.artist + state.now.album };
  if (state.tab === 'coleccion') { const a = state.manual[0] || state.extras[state.extras.length - 1] || state.collection[0]; return a ? { image: a.image, key: a.artist + a.name } : null; }
  if (state.tab === 'ranking' || state.tab === 'stats' || state.tab === 'comprar') { const r = rankingList()[0]; return r ? { image: r.image, key: r.artist + r.name } : null; }
  return null;
}
let tintToken = 0;
function setTint(hex) { document.documentElement.style.setProperty('--tint', hex); }
function applyTint() {
  const a = prefs.get('tintMode') === 'cover' ? tintAlbum() : null, me = ++tintToken;      // por defecto, azul fijo; «según portada» es opcional
  if (!a) return setTint(T.DEFAULT_TINT);
  const url = a.image && imgcache.resolve(a.image);
  const known = url && T.peekTint(url);
  setTint(known || T.normalizeTint(hexToRgb(T.hashTint(a.key))));
  if (url && known === undefined) T.tintFromImage(url).then(hex => { if (hex && me === tintToken) setTint(hex); });
}
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ---------- Estadísticas (una sola página: periodo, tiempo, una gráfica y tus tops) ----------
function vStats() {
  return statsPage({
    stats: state.effStats, history: state.effHistory, collection: state.collection, ranking: rankingList(),
    months: state.months, now: new Date(),
    onPeriod: m => { state.months = m; prefs.set('months', String(m)); render(); },
    onSeeAll: v => { state.rankView = v; prefs.set('rankView', v); go('ranking'); },
    onImport: () => go('ajustes'),
    avatarFor: name => artistAvatar(name),
    coverFor: t => trackCover(t, known()),
    albumCoverFor: r => coverEl(r)
  });
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

const RANK_VIEWS = [['albums', 'Álbumes'], ['artists', 'Artistas'], ['tracks', 'Canciones'], ['forgotten', 'Olvidados']];

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
      h('p', { class: 'muted' }, 'Conecta Spotify o importa tu historial en Ajustes.'),
      h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => go('ajustes') }, 'Ir a Ajustes'))));
    return root;
  }
  root.append(...[liveBar(), nowCard(), rankTabs()].filter(Boolean));
  const view = state.rankView;
  const goSettings = () => go('ajustes');
  if (view === 'forgotten') { root.append(rediscoverView({ state, toast, showPanel, render: () => render(), go, closeSheet: () => closeSheet(), known: () => known() })); return root; }
  // El periodo vale para todas las vistas que usan el historial
  if (hasHistory || state.effStats) root.append(periodBar());
  if (view === 'artists') { root.append(artistsView({ stats: state.effStats, apiAlbums: state.apiAlbums, months: state.months, onImport: goSettings })); return root; }
  if (view === 'tracks') { root.append(tracksView({ stats: state.effStats, months: state.months, onImport: goSettings,
    cover: t => trackCover(t, known()) })); return root; }
  if (!hasHistory && !hasApi) {
    root.append(h('div', { class: 'empty' }, h('p', null, 'Tu export no trae nombres de álbum.'),
      h('p', { class: 'muted' }, 'Paquete básico: no trae álbumes. Conecta Spotify o importa el historial ampliado.')));
    return root;
  }
  if (!hasHistory) root.append(h('p', { class: 'muted' }, 'Ranking aproximado. Importa tu historial en Ajustes para minutos reales.'));
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
    toast(`${st.label}. ${st.detail}` + (state.live.gap ? ' Puede faltar alguna canción.' : ''), st.state === 'error');
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
    h('div', { class: 't' }, h('span', { class: 'nowlbl' }, h('span', { class: 'eq' + (n.playing ? '' : ' paused'), 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), n.playing ? 'Suena ahora' : 'En pausa'), h('b', null, n.title), h('span', null, `${n.artist} · ${n.album}`),
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
  return link !== '#' && !a.manual
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
      h('button', { class: 'btn sec', onclick: () => addview.openAdd(addCtx) }, '+ Añadir disco')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sec', onclick: () => wv.scanSheet(addCtx, { onPick: r => addview.openAdd(addCtx, { prefill: addinfo.discogsInfo(r) }) }) }, 'Escanear código')));
  if (state.extrasLost.length) root.append(lostCard());
  if (state.extrasBad.length) root.append(h('div', { class: 'card' },
    h('p', null, `⚠ Hay ${state.extrasBad.length} disco${state.extrasBad.length === 1 ? '' : 's'} en la nube que no se puede${state.extrasBad.length === 1 ? '' : 'n'} mostrar.`),
    h('button', { class: 'btn sec sm', onclick: showBadExtras }, 'Ver cuáles y por qué')));
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

// Discos guardados en la nube que esta app no puede mostrar (no se borran: solo se explica el motivo)
function showBadExtras() {
  showPanel(h('h2', null, 'Discos que no se pueden mostrar'),
    h('p', { class: 'muted' }, 'Siguen en tu nube, pero con un formato no válido.'),
    h('div', { class: 'card' }, state.extrasBad.map(b => h('div', { class: 'stat col' }, h('b', null, [b.name || '(sin nombre)', b.artist].filter(Boolean).join(' · ')), h('span', { class: 'muted' }, b.why)))),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: closeSheet }, 'Cerrar')));
}

// «×» fijo arriba a la derecha: la ficha siempre se puede cerrar sin tener que bajar hasta «Cerrar»
const closeX = () => h('button', { class: 'sheet-x', type: 'button', 'aria-label': 'Cerrar', title: 'Cerrar', onclick: () => closeSheet() }, icon('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function showPanel(...kids) {
  if (state.scanStop) state.scanStop();
  const sheet = $('#sheet');
  sheet.replaceChildren(h('div', { class: 'panel', role: 'dialog' }, closeX(), ...kids));
  openSheetEl(sheet);
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

// Contexto del formulario «Añadir disco» y de los discos manuales (lista propia: dispositivo + copia en la nube)
const addCtx = {
  state, toast, showPanel, closeSheet: () => closeSheet(),
  coverEl: (...a) => coverEl(...a),
  render: () => render(),
  refreshWish: () => { updateBadge(); if (state.tab === 'comprar') render(); },
  saveWish: () => saveWish(),
  storeNames: () => storeNames(),
  addManual: a => { state.manual = [a, ...state.manual]; saveManual(); },
  updateManual: a => { state.manual = state.manual.map(x => (x.id === a.id ? a : x)); saveManual(); },
  removeManual: id => { state.manual = state.manual.filter(x => x.id !== id); saveManual(); },
  addToMiApp: async album => { applyExtras(await fb.addAlbum(album)); rebuildCollection(); render(); }
};
function saveManual() { rebuildCollection(); store.set('manual', state.manual); scheduleCloud('manual'); if (state.tab === 'coleccion') render(); }

// Vuelve a leer el CSV de mi-app y, con sesión, los discos añadidos en la nube
async function syncAll() {
  if (state.syncing) return;
  state.syncing = true; state.syncError = ''; updateSyncUi();
  try {
    state.base = await collection.loadBase({ force: true });
    state.csvAt = await collection.csvAt();
    if (fb.isLoggedIn()) applyExtras(await fb.readExtras({ force: true }));
    rebuildCollection();
    toast(fb.isLoggedIn() ? `Colección sincronizada: ${state.base.length} en mi-app y ${state.extras.length} añadidos en la nube` + (state.extrasBad.length ? ` (${state.extrasBad.length} no se pueden mostrar)` : '') : 'Colección sincronizada');
  } catch (e) { state.syncError = e.message; toast(e.message, true); }
  finally { state.syncing = false; if (state.tab === 'coleccion' || state.tab === 'ajustes') render(); else updateSyncUi(); }
}
const syncExtras = syncAll;

// ---------- Comprar (sugeridos · deseos · comprados) ----------
const BUY_VIEWS = [['sugeridos', 'Sugeridos'], ['deseos', 'Deseos'], ['comprados', 'Comprados']];

let buyToken = 0;
// Esqueleto: filas grises que parpadean con la forma de lo que va a aparecer
const skeletonList = (n = 7) => h('ul', { class: 'list skel-list', 'aria-busy': 'true', 'aria-label': 'Cargando' }, Array.from({ length: n }, () => h('li', null,
  h('div', { class: 'row static skel' }, h('i', { class: 'sk n' }), h('i', { class: 'sk cv' }), h('div', { class: 't' }, h('i', { class: 'sk l1' }), h('i', { class: 'sk l2' })), h('i', { class: 'sk m' })))));

function vBuy() {
  const root = h('div');
  const nWish = state.wish.filter(w => w.status === 'wanted').length, nBought = state.wish.filter(w => w.status === 'bought').length;
  const labels = { sugeridos: 'Sugeridos', deseos: 'Deseos' + (nWish ? ` (${nWish})` : ''), comprados: 'Comprados' + (nBought ? ` (${nBought})` : '') };
  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' }, BUY_VIEWS.map(([k]) =>
    h('button', { 'aria-pressed': String(state.buyView === k), onclick: () => { state.buyView = k; prefs.set('buyView', k); render(); } }, labels[k]))));
  if (state.buyView === 'deseos') { root.append(wv.wishView(wishCtx)); return root; }
  if (state.buyView === 'comprados') { root.append(wv.boughtView(wishCtx)); return root; }

  // Periodo propio de Sugeridos (no toca el de Estadísticas ni el del Ranking)
  const BUY_PERIODS = [[6, '6 meses'], [12, '1 año'], [24, '2 años'], [0, 'Todo']];
  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Escuchado en' }, BUY_PERIODS.map(([m, l]) =>
    h('button', { 'aria-pressed': String(state.buyMonths === m), onclick: () => { state.buyMonths = m; prefs.set('buyMonths', String(m)); state.buyShown = 40; state.vinylRun++; state.vinylProgress.running = false; render(); } }, l))));

  // La parte pesada se pinta en el cuadro siguiente: primero sale el esqueleto gris con la forma de la lista (si la última vez tardó) y luego el contenido
  const build = () => {
    const root = h('div');
    const bought = W.boughtKeys(state.wish), wanted = W.wantedKeys(state.wish);
    const cands = C.minArtistPlays(rankingList(state.buyMonths), 2).filter(r => !r.owned && !bought.has(r.key));     // artistas con más de 1 reproducción
    if (!cands.length) {
      root.append(h('div', { class: 'empty' }, 'Aquí saldrá lo que escuchas y no tienes en vinilo.'));
      return root;
    }
    // Solo discos que existen en vinilo: los que ya tienen oferta de tienda y los que Discogs confirma (se comprueban poco a poco y se recuerdan 30 días)
    const canCheck = discogs.hasToken();
    const isVinyl = r => r.offers.length > 0 || state.vinyl.get(r.key) === true || (state.prices.get(r.key) && !state.prices.get(r.key).none);
    const confirmed = canCheck ? cands.filter(isVinyl) : cands;
    const unknown = canCheck ? cands.filter(r => !r.offers.length && !state.vinyl.has(r.key)) : [];
    if (unknown.length && !state.peeking) {
      state.peeking = true;      // lo ya comprobado antes (caché local) se lee sin red, solo de los primeros candidatos
      Promise.all(unknown.slice(0, 300).map(r => discogs.vinylPeek(r).then(v => { if (v !== undefined) state.vinyl.set(r.key, v); return v !== undefined; })))
        .then(found => { state.peeking = false; if (found.some(Boolean) && state.tab === 'comprar') renderQuiet(); else if (state.tab === 'comprar') verifyVinyl(cands); });
    } else if (unknown.length) { /* ya se está leyendo la caché */ } else verifyVinyl(cands);

    const missing = confirmed.slice(0, state.buyShown + 20).filter(r => !state.prices.has(r.key));
    if (missing.length && !state.pricePeeking) {
      state.pricePeeking = true;      // precios ya consultados antes (caché local): se pintan sin red
      Promise.all(missing.map(r => discogs.peek(r).then(v => { if (v) state.prices.set(r.key, v); return !!v; })))
        .then(found => { state.pricePeeking = false; if (found.some(Boolean) && state.tab === 'comprar') renderQuiet(); });
    }
    const withPrice = r => C.estimate({ discogs: state.prices.get(r.key) }, r.offers) != null;
    const filters = { todos: () => true, precio: withPrice, stock: r => r.offers.some(o => o.available) };
    if (!filters[state.filter]) state.filter = 'todos';
    const list = confirmed.filter(filters[state.filter]);
    if (state.filter === 'precio') fetchPrices(confirmed);          // al elegir «Con precio» se consulta Discogs (de uno en uno, con caché de 12 h)

    root.append(h('p', { class: 'muted' }, 'Lo que escuchas y no tienes en vinilo. Toca un disco para ver dónde comprarlo.'));
    root.append(h('div', { class: 'chips' }, [['todos', 'Todos'], ['precio', 'Con precio'], ['stock', 'En stock']]
      .map(([k, label]) => h('button', { class: 'chip', 'aria-pressed': String(state.filter === k), onclick: () => { state.priceRun++; state.priceProgress.running = false; state.filter = k; state.buyShown = 40; render(); } }, label))));
    if (state.filter === 'precio') {
      const pp = state.priceProgress;
      root.append(h('p', { class: 'muted' + (pp.error ? ' bad' : ''), role: 'status', id: 'price-progress' },
        pp.error ? pp.error : pp.running ? `Consultando precios en Discogs… ${pp.done}/${pp.total}` : discogs.hasToken() ? 'Tienda y Discogs (copia más barata).' : 'Solo precios de tienda. Para los de Discogs, añade tu token en Ajustes.'));
    }
    const vp = state.vinylProgress;
    const shown = list.slice(0, state.buyShown);
    root.append(shown.length ? h('ul', { class: 'list' }, shown.map((r, i) => albumRow({ ...r, wished: wanted.has(r.key) }, i)))
      : vp.running || (canCheck && unknown.length && !vp.error) ? skeletonList(4) : h('div', { class: 'empty' }, vp.error ? '' : 'Nada con este filtro.'));
    if (list.length > shown.length) root.append(h('button', { class: 'btn sec wide', type: 'button', onclick: () => { state.buyShown += 40; render(); } }, `Ver más (${list.length - shown.length})`));
    if (canCheck && (vp.running || vp.error)) root.append(h('p', { class: 'muted' + (vp.error ? ' bad' : ''), role: 'status' }, vp.error || `Comprobando en Discogs cuáles existen en vinilo… ${vp.done}`));
    if (!canCheck) root.append(h('p', { class: 'muted' }, 'Añade tu token de Discogs en Ajustes para ver solo los discos que existen en vinilo.'));
    return root;
  };
  const slot = h('div');
  const run = () => { const t0 = performance.now(); const c = build(); state.buyCost = performance.now() - t0; return c; };
  if (quietRender || (state.buyCost !== undefined && state.buyCost < 40)) slot.append(run());
  else {
    slot.append(skeletonList());
    const mine = ++buyToken;
    requestAnimationFrame(() => setTimeout(() => { if (mine === buyToken && slot.isConnected) slot.replaceChildren(run()); }, 0));
  }
  root.append(slot);
  return root;
}

// Comprueba en Discogs, de uno en uno y en orden, qué discos existen en vinilo hasta tener los que se muestran (y unos pocos más). Se recuerda 30 días.
let vinylRepaintAt = 0;
async function verifyVinyl(cands) {
  const vp = state.vinylProgress;
  if (vp.running || !discogs.hasToken()) return;
  const need = state.buyShown + 10, me = ++state.vinylRun;
  const confirmedCount = () => cands.filter(r => r.offers.length || state.vinyl.get(r.key) === true).length;
  if (confirmedCount() >= need) return;
  vp.running = true; vp.done = 0; vp.error = ''; let did = false;
  const repaint = (force) => {
    if (state.tab !== 'comprar' || state.buyView !== 'sugeridos' || me !== state.vinylRun) return;
    if (!force && Date.now() - vinylRepaintAt < 1500) return;
    vinylRepaintAt = Date.now(); const top = view.scrollTop; renderQuiet(); view.scrollTop = top;
  };
  for (const r of cands) {
    if (me !== state.vinylRun) return;                             // se cambió de pestaña, periodo o filtro
    if (confirmedCount() >= need || vp.done >= 150) break;
    if (r.offers.length || state.vinyl.has(r.key) || state.vinylTried.has(r.key)) continue;
    state.vinylTried.add(r.key); did = true;
    try { const v = await discogs.hasVinyl(r); state.vinyl.set(r.key, v); if (v) repaint(false); }
    catch (e) { vp.error = e.message; break; }
    vp.done++;
  }
  if (me === state.vinylRun) { vp.running = false; if (did) setTimeout(() => repaint(true), 0); }
}

// Precios de Discogs para «Con precio»: los primeros 60 sugeridos, de uno en uno (límite de Discogs) y guardados 12 h.
// Cada intento se anota para no repetirlo en bucle; si Discogs rechaza el token o pide calma, se para y se avisa.
async function fetchPrices(all) {
  const pp = state.priceProgress;
  if (pp.running || !discogs.hasToken()) return;
  const todo = all.slice(0, 60).filter(r => !state.prices.has(r.key) && !state.priceTried.has(r.key));
  if (!todo.length) return;
  pp.running = true; pp.done = 0; pp.total = todo.length; pp.error = '';
  const me = ++state.priceRun;
  const repaint = () => { if (state.tab === 'comprar' && state.buyView === 'sugeridos' && state.filter === 'precio') { const top = view.scrollTop; renderQuiet(); view.scrollTop = top; } };
  setTimeout(repaint, 0);
  for (const r of todo) {
    if (me !== state.priceRun) break;                         // se cambió de pestaña o de filtro
    state.priceTried.add(r.key);
    try { state.prices.set(r.key, await discogs.lookup(r, config.currency)); }
    catch (e) { pp.error = e.message; break; }
    pp.done++;
    repaint();
  }
  if (me === state.priceRun) pp.running = false;
  repaint();
}

// ---------- Conciertos ----------
function vConcerts() { return concertsView({ state, onSettings: () => go('ajustes') }); }

// ---------- Deseos: contexto para las pantallas, guardado y avisos ----------
const saveWish = () => { scheduleCloud('wish'); return store.set('wishlist', state.wish); };

// ---------- Copia en la nube (Firestore de mi-app; solo el dueño) ----------
const cloudSource = { manual: () => state.manual, wish: () => state.wish, live: () => state.live, history: () => ({ history: state.history, info: state.historyInfo, stats: state.stats }), prefs: () => cloud.collectPrefs() };
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
      if (k === 'manual' && !state.manual.length && !cloud.localAt('manual')) continue;
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
    const mn = await cloud.pullKey('manual');
    if (mn && Array.isArray(mn.data) && mn.at > cloud.localAt('manual') && !dirty.has('manual')) { state.manual = mn.data; await store.set('manual', state.manual); rebuildCollection(); }
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
  storeNames: () => storeNames(),
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

// Mira las tiendas (catálogos descargados) y avisa de lo que acaba de aparecer en stock o preventa. Discogs no cuenta.
async function wishCheck() {
  if (state.wishBusy || !state.wish.some(w => w.status === 'wanted')) { updateBadge(); return; }
  state.wishBusy = true;
  try {
    const r = W.checkAll(state.wish, { storeIndex: state.storeIndex });
    state.wish = r.list;
    await saveWish();
    if (r.alerts.length) notifyAlerts(r.alerts);
    updateBadge();
    if (state.tab === 'comprar') render();
  } finally { state.wishBusy = false; }
}

// Nombres de las tiendas con catálogo descargado: «A», «A y B», «A, B y C»
const storeNames = () => { const n = [...new Set(state.storeIndex.map(o => o.store))]; return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0] || 'las tiendas'; };

// ---------- Ficha de álbum ----------
let closeTimer;
function closeSheet() {
  if (state.scanStop) state.scanStop();      // apaga la cámara si el lector estaba abierto
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  if (reduceMotion()) { sheet.hidden = true; sheet.replaceChildren(); return; }
  sheet.classList.add('closing');            // se desliza hacia abajo y luego se oculta
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { sheet.classList.remove('closing'); sheet.hidden = true; sheet.replaceChildren(); }, 230);
}
const openSheetEl = sheet => { clearTimeout(closeTimer); sheet.classList.remove('closing'); sheet.hidden = false; };

async function openSheet(r) {
  const sheet = $('#sheet');
  const body = h('div');
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': r.name }, closeX(), body);
  sheet.replaceChildren(panel); openSheetEl(sheet);
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
          : h('p', { class: 'muted' }, state.storeIndex.length ? `No aparece en ${storeNames()}.` : 'Aún no hay datos de tiendas.'),
        h('div', { class: 'offer' }, h('div', null, h('b', null, 'Fnac'), h('small', null, 'Bloquea consultas automáticas: búscalo a mano')),
          h('a', { href: C.fnacUrl(r), target: '_blank', rel: 'noopener' }, 'Buscar')),
        h('div', { class: 'offer' }, h('div', null, h('b', null, 'El Corte Inglés'), h('small', null, 'Bloquea consultas automáticas: búscalo a mano')),
          h('a', { href: C.corteInglesUrl(r), target: '_blank', rel: 'noopener' }, 'Buscar'))) : null,
      !r.owned ? h('div', { class: 'card' }, h('h3', null, 'Discogs (mercado)'),
        d && !d.none ? [
          h('div', { class: 'stat' }, h('span', null, 'Copia más barata'), h('b', null, C.money(d.lowest))),
          h('div', { class: 'stat' }, h('span', null, 'A la venta'), h('b', null, d.forSale ?? '—')),
          h('div', { class: 'stat' }, h('span', null, 'La tienen / la quieren'), h('span', null, `${d.have ?? '—'} / ${d.want ?? '—'}`)),
          h('a', { href: safeUrl(d.url), target: '_blank', rel: 'noopener' }, 'Ver en Discogs')]
          : d && d.none ? h('p', { class: 'muted' }, 'No hay edición en vinilo en Discogs.')
            : h('button', { class: 'btn sec', id: 'dlook' }, 'Consultar precio')) : null,
      !r.owned ? wv.wishButtons(wishCtx, r, paint) : null,
      r.manual ? h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => addview.openAdd(addCtx, { editing: state.manual.find(m => m.id === r.id) || r }) }, 'Editar etiquetas y datos'),
        h('button', { class: 'btn danger', onclick: () => { if (confirm('¿Quitar este disco de la colección?')) { addCtx.removeManual(r.id); closeSheet(); } } }, 'Quitar')) : null,
      r.tags && r.tags.length ? h('div', { class: 'chips' }, r.tags.map(t => h('span', { class: 'chip' }, t))) : null,
      h('div', { class: 'btns' }, spotifyLink && spotifyLink !== '#' ? h('a', { class: 'btn sec', href: safeUrl(spotifyLink), target: '_blank', rel: 'noopener' }, 'Abrir en Spotify') : null,
        h('button', { class: 'btn sec', onclick: closeSheet }, 'Cerrar')));
    const btn = body.querySelector('#dlook');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Consultando…';
      try { state.prices.set(r.key, await discogs.lookup(r, config.currency)); } catch (e) { toast(e.message, true); }
      paint(); if (state.tab === 'comprar') render();
    });
  };
  paint();
  discogs.peek(r).then(cached => { if (cached && !state.prices.has(r.key) && !$('#sheet').hidden && panel.isConnected) { state.prices.set(r.key, cached); paint(); } }).catch(() => {});
}

// ---------- Ajustes ----------
// Tarjeta «Copia en la nube» de Ajustes
function cloudCard() {
  return h('div', { class: 'card', id: 'cloud-card' }, h('h3', null, 'Copia en la nube'),
    cloud.available()
      ? [h('p', { class: 'muted' }, 'Deseos, comprados, historial, registro en vivo y ajustes. Los tokens no se suben.'),
        state.cloudError ? h('p', { class: 'muted bad' }, state.cloudError) : h('p', { class: 'own' }, state.cloudBusy ? 'Sincronizando…' : state.cloudAt ? '✓ Sincronizado ' + when(state.cloudAt) : 'Pendiente de sincronizar'),
        state.cloudError && /403/.test(state.cloudError) ? h('p', { class: 'muted' }, 'Falta una regla en Firestore: permite leer y escribir en /vinilos/{doc} a tu cuenta de dueño.') : null,
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
    h('p', { class: 'muted' }, 'La cuenta de tu app Vinilos. La contraseña no se guarda.'),
    fb.isLoggedIn()
      ? [h('p', null, 'Sesión iniciada como ', h('b', null, fb.user()), fb.isOwner() ? ' (dueño: puedes añadir discos)' : ''),
        h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: syncExtras }, 'Sincronizar ahora'),
          h('button', { class: 'btn danger', onclick: () => { fb.logout(); state.extras = []; state.extrasBad = []; state.extrasLost = []; rebuildCollection(); render(); } }, 'Cerrar sesión'))]
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
      '. Se actualiza sola con la app abierta.') : null,
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
      h('p', { class: 'muted' }, 'Pulsa el botón, copia el enlace, ábrelo en Safari y acepta. Luego pega aquí abajo la dirección a la que te lleve.'),
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
      h('p', { class: 'muted' }, 'Pega la dirección completa tras aceptar.'),
      paste, h('button', { class: 'btn sec', onclick: async () => {
        try { await spotify.finishLogin(paste.value); toast('Spotify conectado'); await refreshApi(); } catch (e) { toast(e.message, true); }
      } }, 'Completar conexión'))));

  // Historial
  const file = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', multiple: true });
  const info = state.historyInfo;
  root.append(h('div', { class: 'card' }, h('h3', null, 'Historial de Spotify (minutos reales)'),
    h('p', { class: 'muted' }, 'Pídelo en spotify.com/account/privacy: «Historial ampliado» (con álbumes) o «Datos de la cuenta» (más rápido, sin álbumes). Importa el .zip tal cual; se procesa en tu móvil.'),
    info ? h('p', null, `${info.basic ? 'paquete básico (sin álbumes)' : info.albums + ' álbumes'} · ${info.plays} reproducciones · ${info.from} → ${info.to}`) : null,
    file, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => importHistory(file.files) }, 'Importar'),
      info ? h('button', { class: 'btn danger', onclick: async () => { await store.del('history'); await store.del('historyInfo'); await store.del('stats'); state.history = {}; state.historyInfo = null; state.stats = null; recompute(); render(); } }, 'Borrar historial') : null)));

  // Discogs
  const du = h('input', { type: 'text', value: prefs.get('discogs.user'), autocapitalize: 'none', placeholder: 'usuario de Discogs' });
  const dt = h('input', { type: 'password', value: prefs.get('discogs.token'), autocomplete: 'off', placeholder: 'token personal' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Discogs'),
    h('p', { class: 'muted' }, 'Token en discogs.com/settings/developers. Solo se guarda en este dispositivo.'),
    field('Usuario', du), field('Token', dt),
    h('button', { class: 'btn', onclick: () => { prefs.set('discogs.user', du.value.trim()); prefs.set('discogs.token', dt.value.trim()); toast('Guardado'); } }, 'Guardar')));

  // Tema
  const theme = h('select', { 'aria-label': 'Tema' }, [['', 'Oscuro'], ['light', 'Claro'], ['auto', 'Automático (del sistema)']].map(([v, l]) => h('option', { value: v }, l)));
  theme.value = prefs.get('theme');
  theme.addEventListener('change', () => { prefs.set('theme', theme.value); applyTheme(theme.value); });
  const tintSel = h('select', { 'aria-label': 'Color de fondo' }, [['', 'Azul'], ['cover', 'Según la portada']].map(([v, l]) => h('option', { value: v }, l)));
  tintSel.value = prefs.get('tintMode');
  tintSel.addEventListener('change', () => { prefs.set('tintMode', tintSel.value); applyTint(); });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Tema'), theme, h('h3', { style: 'margin-top:14px' }, 'Color de fondo'), tintSel));

  // Datos
  root.append(h('div', { class: 'card' }, h('h3', null, 'Datos'),
    h('p', { class: 'muted' }, `VinylTracker ${VERSION}. Los datos se guardan en este dispositivo. Tiendas: ${storeNames()}.`),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: checkUpdate }, 'Buscar actualización')),
    h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm('¿Borrar todos los datos de VinylTracker de este dispositivo?')) return;
      await store.clearAll();
      Object.keys(localStorage).filter(k => k.startsWith('vt.')).forEach(k => localStorage.removeItem(k));
      location.reload();
    } }, 'Borrar todo')));
  return root;
}

// Lee el zip y, si no se puede, dice POR QUÉ (tamaño, si empieza como un zip…) en vez de un genérico "no válido"
async function readZipFile(f) {
  const buf = await f.arrayBuffer();
  try { return await readSpotifyZip(buf); }
  catch (e) {
    if (!/No parece un \.zip/.test(e.message)) throw e;
    const mb = (buf.byteLength / 1e6).toFixed(1), head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (!buf.byteLength) throw new Error('El archivo está vacío (0 bytes). Si está en iCloud Drive, ábrelo antes en Archivos para que se descargue del todo.');
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error(`«${f.name}» (${mb} MB) no empieza como un zip. ¿Es el archivo de Spotify tal cual, sin descomprimir ni renombrar?`);
    throw new Error(`El zip (${mb} MB) está dañado o incompleto y no pude recuperar ningún archivo de música. Descárgalo otra vez de Spotify.`);
  }
}

// Pide al navegador que compruebe si hay una versión nueva; si la hay, la descarga y la app se recarga sola
async function checkUpdate() {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (!reg) return toast('Este navegador no permite comprobar actualizaciones.', true);
    toast('Buscando actualización…');
    await reg.update();
    if (reg.installing || reg.waiting) toast('Descargando la nueva versión… la app se recargará sola.');
    else toast(`Ya tienes la última versión (${VERSION}).`);
  } catch (e) { toast('No se pudo comprobar: ' + e.message + '. ¿Hay conexión?', true); }
}

async function importHistory(files) {
  if (!files || !files.length) return toast('Elige el .zip o los .json del export', true);
  try {
    setStatus('Importando…');
    let entries = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip') for (const e of await readZipFile(f)) entries.push(e);
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
    go(info.basic ? 'stats' : 'ranking');
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
  if ('serviceWorker' in navigator) {
    // Si llega una versión nueva, la app se recarga sola una vez (así no hace falta abrirla dos veces para ver el cambio)
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
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
    fb.readExtras().then(r => { if (!r.fromCache) { applyExtras(r); rebuildCollection(); render(); } })
      .catch(e => { state.syncError = e.message; updateSyncUi(); });
  }
}

// Pantalla de "casi listo": se enseña cuando Spotify vuelve a una ventana que no puede completar la conexión
// (típico en iPhone: vuelve a Safari en vez de a la app instalada). La dirección se conserva para copiarla.
function showLanding(url, reason) {
  const box = h('textarea', { readonly: true, rows: '5', style: 'width:100%;font-size:12px;user-select:text;-webkit-user-select:text' });
  box.value = url;
  paintToken++;                                  // que un pintado pendiente no tape este aviso
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
