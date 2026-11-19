import { config } from './config.js';
import * as C from './core.js';
import * as store from './storage.js';
import { prefs } from './storage.js';
import * as spotify from './spotify.js';
import * as discogs from './discogs.js';
import * as fb from './firebase.js';
import * as collection from './collection.js';
import { readSpotifyZip } from './zip.js';

const VERSION = '1.0.2';
const $ = s => document.querySelector(s);
const view = $('#view');
// Sin zoom: iOS ignora a veces user-scalable=no, así que se bloquean también los gestos de pellizco
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());

// ---------- utilidades de interfaz (todo con textContent: nada de HTML de terceros) ----------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'disabled' || k === 'checked') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');
const when = ts => (ts ? new Date(ts).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 7000 : 3500);
}
const setStatus = s => { $('#status').textContent = s || ''; };

function coverEl(a, cls = '') {
  const letter = (a.name || a.artist || '?').trim().charAt(0).toUpperCase();
  const ph = () => h('div', { class: 'cover ph ' + cls }, letter);
  if (!a.image) return ph();
  const img = h('img', { class: 'cover ' + cls, src: safeUrl(a.image), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(ph()));
  return img;
}

// ---------- estado ----------
const state = {
  tab: prefs.get('tab', 'ranking'),
  months: Number(prefs.get('months', '12')),
  history: {}, apiAlbums: {}, apiAt: 0, historyInfo: null,
  base: [], extras: [], extrasAt: 0, owned: null, collection: [],
  storeIndex: [], storeDate: '',
  prices: new Map(),          // key -> { discogs }
  filter: 'todos', search: '', busy: ''
};

const rankingList = () => C.buildRanking({ history: state.history, api: state.apiAlbums, months: state.months })
  .map(r => ({ ...r, owned: C.isOwned(r, state.owned), offers: C.matchStores(r, state.storeIndex) }));

async function loadAll() {
  state.history = await store.get('history', {});
  state.historyInfo = await store.get('historyInfo', null);
  const api = await store.get('api', null);
  if (api) { state.apiAlbums = api.albums; state.apiAt = api.at; }
  try { state.base = await collection.loadBase(); } catch (e) { toast('No se pudo leer tu colección de mi-app: ' + e.message, true); }
  const ex = await fb.cachedExtras();
  if (ex) { state.extras = ex.albums; state.extrasAt = ex.at; }
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
  view.replaceChildren(({ ranking: vRanking, coleccion: vCollection, comprar: vBuy, ajustes: vSettings })[state.tab]());
  const n = state.collection.length;
  setStatus(n ? `${n} vinilos en tu colección` : '');
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
      r.owned ? h('span', { class: 'own' }, '✓ En tu colección') : priceChip(r)),
    metric(r)));
}

function vRanking() {
  const root = h('div');
  const hasHistory = Object.keys(state.history).length > 0;
  const hasApi = Object.keys(state.apiAlbums).length > 0;
  if (!hasHistory && !hasApi) {
    root.append(h('div', { class: 'empty' },
      h('p', null, 'Todavía no hay datos de escucha.'),
      h('p', { class: 'muted' }, 'Conecta Spotify o importa tu historial (export de datos) en Ajustes.'),
      h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => go('ajustes') }, 'Ir a Ajustes'))));
    return root;
  }
  if (hasHistory) root.append(periodBar());
  else root.append(h('p', { class: 'muted' }, 'Ranking aproximado con tus tops de Spotify. Para minutos reales importa el export de tu historial en Ajustes.'));
  const list = rankingList().slice(0, 60);
  const sources = [hasHistory && 'historial', hasApi && 'API de Spotify'].filter(Boolean).join(' + ');
  root.append(h('div', { class: 'chips' }, h('span', { class: 'chip' }, 'Fuente: ' + sources),
    h('span', { class: 'chip' }, list.filter(r => r.owned).length + ' ya los tienes')));
  if (!list.length) root.append(h('div', { class: 'empty' }, 'No hay reproducciones en este periodo.'));
  else root.append(h('ul', { class: 'list' }, list.map(albumRow)));
  return root;
}

// ---------- Colección ----------
function vCollection() {
  const root = h('div');
  const syncBtn = h('button', { class: 'btn sec', onclick: syncExtras }, 'Sincronizar');
  root.append(h('div', { class: 'card' },
    h('div', { class: 'stat' }, h('span', null, 'Vinilos'), h('b', null, state.collection.length)),
    h('div', { class: 'stat' }, h('span', null, 'En mi-app (CSV)'), h('b', null, state.base.length)),
    h('div', { class: 'stat' }, h('span', null, 'Añadidos desde la app'),
      h('b', null, fb.isLoggedIn() ? `${state.extras.length}` : 'inicia sesión en Ajustes')),
    fb.isLoggedIn() ? h('p', { class: 'muted' }, 'Última lectura de la nube: ' + when(state.extrasAt)) : null,
    fb.isLoggedIn() ? h('div', { class: 'btns' }, syncBtn) : null));
  const val = state.discogsValue;
  if (val) root.append(h('div', { class: 'card' }, h('h3', null, 'Valor en Discogs'),
    h('div', { class: 'stat' }, h('span', null, 'Mediana'), h('b', { class: 'big' }, val.median)),
    h('div', { class: 'stat' }, h('span', null, 'Mínimo – máximo'), h('span', null, `${val.minimum} – ${val.maximum}`))));
  else if (prefs.get('discogs.token') && prefs.get('discogs.user')) {
    root.append(h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: loadValue }, 'Calcular valor de mi colección (Discogs)')));
  }
  const q = h('input', { type: 'search', placeholder: 'Buscar artista o álbum', value: state.search, 'aria-label': 'Buscar' });
  const gridHost = h('div');
  const paint = () => {
    const s = C.fold(state.search);
    const items = state.collection.filter(a => !s || C.fold(a.artist + ' ' + a.name).includes(s))
      .sort((a, b) => C.fold(a.artist).localeCompare(C.fold(b.artist)) || C.fold(a.name).localeCompare(C.fold(b.name)));
    gridHost.replaceChildren(items.length
      ? h('div', { class: 'grid' }, items.map(a => h('button', { class: 'cell', onclick: () => openSheet({ ...a, key: C.albumKey(a.artist, a.name), owned: true, offers: [] }) },
        coverEl(a), h('b', null, a.name), h('span', null, a.artist))))
      : h('div', { class: 'empty' }, 'Sin resultados'));
  };
  q.addEventListener('input', () => { state.search = q.value; paint(); });
  root.append(q, gridHost);
  paint();
  return root;
}

async function syncExtras() {
  try {
    setStatus('Sincronizando…');
    const r = await fb.readExtras({ force: true });
    state.extras = r.albums; state.extrasAt = r.at; rebuildCollection(); render();
    toast(`Colección sincronizada: ${state.extras.length} discos añadidos desde la app`);
  } catch (e) { toast(e.message, true); render(); }
}

async function loadValue() {
  try {
    state.discogsValue = await discogs.collectionValue(prefs.get('discogs.user'));
    render();
  } catch (e) { toast(e.message, true); }
}

// ---------- Comprar ----------
let cancelLookup = false;

function vBuy() {
  const root = h('div');
  const all = rankingList().filter(r => !r.owned).slice(0, 40);
  const missing = all.filter(r => !state.prices.has(r.key));
  if (missing.length && !state.peeking) {
    state.peeking = true;      // precios ya consultados antes (caché local): se pintan sin red
    Promise.all(missing.map(r => discogs.peek(r).then(v => { if (v) state.prices.set(r.key, v); return !!v; })))
      .then(found => { state.peeking = false; if (found.some(Boolean) && state.tab === 'comprar' && !state.busy) render(); });
  }
  const withPrice = r => C.estimate({ discogs: state.prices.get(r.key) }, r.offers) != null;
  const filters = {
    todos: () => true, precio: withPrice,
    stock: r => r.offers.some(o => o.available), preventa: r => r.offers.some(o => o.preorder)
  };
  const list = all.filter(filters[state.filter]);
  const total = all.reduce((s, r) => s + (C.estimate({ discogs: state.prices.get(r.key) }, r.offers) || 0), 0);
  const priced = all.filter(withPrice).length;

  if (!all.length) {
    root.append(h('div', { class: 'empty' }, 'Cuando haya ranking, aquí verás qué te falta en vinilo y cuánto cuesta.'));
    return root;
  }
  root.append(h('div', { class: 'card' },
    h('p', { class: 'muted' }, 'Coste de comprar en vinilo lo que aún no tienes (top 40)'),
    h('div', { class: 'big' }, C.money(total)),
    h('p', { class: 'muted' }, `${priced} de ${all.length} con precio · tiendas actualizadas: ${state.storeDate ? when(Date.parse(state.storeDate)) : 'sin datos'}`),
    state.busy ? h('div', null, h('div', { class: 'bar' }, h('i', { style: `width:${state.busyPct || 0}%` })), h('p', { class: 'muted' }, state.busy),
      h('button', { class: 'btn sec', onclick: () => { cancelLookup = true; } }, 'Parar'))
      : h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => lookupAll(all) }, 'Buscar precios en Discogs'))));
  root.append(h('div', { class: 'chips' }, [['todos', 'Todos'], ['precio', 'Con precio'], ['stock', 'En stock'], ['preventa', 'Preventa']]
    .map(([k, label]) => h('button', { class: 'chip', 'aria-pressed': String(state.filter === k), onclick: () => { state.filter = k; render(); } }, label))));
  root.append(list.length ? h('ul', { class: 'list' }, list.map(albumRow)) : h('div', { class: 'empty' }, 'Nada con este filtro.'));
  return root;
}

async function lookupAll(albums) {
  cancelLookup = false;
  let done = 0;
  for (const r of albums) {
    if (cancelLookup) break;
    state.busy = `Consultando Discogs: ${r.artist} – ${r.name}`; state.busyPct = Math.round(done / albums.length * 100);
    if (state.tab === 'comprar') render();
    try { state.prices.set(r.key, await discogs.lookup(r, config.currency)); }
    catch (e) { toast(e.message, true); break; }
    done++;
  }
  state.busy = '';
  if (state.tab === 'comprar') render();
}

// ---------- Ficha de álbum ----------
function closeSheet() { $('#sheet').hidden = true; $('#sheet').replaceChildren(); }

async function openSheet(r) {
  const sheet = $('#sheet');
  const body = h('div');
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': r.name }, body);
  sheet.replaceChildren(panel); sheet.hidden = false;
  sheet.onclick = e => { if (e.target === sheet) closeSheet(); };

  const paint = () => {
    const d = state.prices.get(r.key);
    const offers = r.offers || [];
    const spotifyLink = r.id ? `https://open.spotify.com/album/${r.id}` : r.url;
    body.replaceChildren(
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
function field(label, input) { return h('div', null, h('label', null, label), input); }

function vSettings() {
  const root = h('div');

  // Cuenta de mi-app
  const u = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', placeholder: 'usuario', value: fb.user() || '' });
  const p = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'contraseña' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Cuenta de mi-app'),
    h('p', { class: 'muted' }, 'La misma cuenta de tu app Vinilos. Sirve para leer los discos que añades desde allí. La contraseña no se guarda.'),
    fb.isLoggedIn()
      ? [h('p', null, 'Sesión iniciada como ', h('b', null, fb.user())),
        h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: syncExtras }, 'Sincronizar ahora'),
          h('button', { class: 'btn danger', onclick: () => { fb.logout(); state.extras = []; rebuildCollection(); render(); } }, 'Cerrar sesión'))]
      : [field('Usuario', u), field('Contraseña', p),
        h('button', { class: 'btn', onclick: async e => {
          e.target.disabled = true;
          try { await fb.login(u.value, p.value); await syncExtras(); } catch (err) { toast(err.message, true); }
          render();
        } }, 'Iniciar sesión')]));

  // Spotify
  const cid = h('input', { type: 'text', value: spotify.clientId(), autocapitalize: 'none', 'aria-label': 'Client ID' });
  const paste = h('input', { type: 'url', placeholder: 'https://…/?code=…&state=…', autocapitalize: 'none' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Spotify'),
    spotify.isConnected() ? h('p', { class: 'own' }, '✓ Conectado · última carga: ' + when(state.apiAt)) : h('p', { class: 'muted' }, 'Sin conectar.'),
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
      spotify.isConnected() ? h('button', { class: 'btn danger', onclick: () => { spotify.disconnect(); render(); } }, 'Desconectar') : null),
    h('details', null, h('summary', { class: 'muted' }, 'Si al volver de Spotify no entra solo'),
      h('p', { class: 'muted' }, 'Copia la URL completa de la barra de direcciones tras aceptar y pégala aquí.'),
      paste, h('button', { class: 'btn sec', onclick: async () => {
        try { await spotify.finishLogin(paste.value); await refreshApi(); } catch (e) { toast(e.message, true); }
      } }, 'Completar conexión'))));

  // Historial
  const file = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', multiple: true });
  const info = state.historyInfo;
  root.append(h('div', { class: 'card' }, h('h3', null, 'Historial de Spotify (minutos reales)'),
    h('p', { class: 'muted' }, 'spotify.com/account/privacy → "Historial de reproducciones ampliado". Importa el .zip tal cual (o todos los .json a la vez; una nueva importación sustituye a la anterior). Se procesa en tu móvil, no se sube a ningún sitio.'),
    info ? h('p', null, `${info.albums} álbumes · ${info.plays} reproducciones · ${info.from} → ${info.to}`) : null,
    file, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => importHistory(file.files) }, 'Importar'),
      info ? h('button', { class: 'btn danger', onclick: async () => { await store.del('history'); await store.del('historyInfo'); state.history = {}; state.historyInfo = null; render(); } }, 'Borrar historial') : null)));

  // Discogs
  const du = h('input', { type: 'text', value: prefs.get('discogs.user'), autocapitalize: 'none', placeholder: 'usuario de Discogs' });
  const dt = h('input', { type: 'password', value: prefs.get('discogs.token'), autocomplete: 'off', placeholder: 'token personal' });
  root.append(h('div', { class: 'card' }, h('h3', null, 'Discogs'),
    h('p', { class: 'muted' }, 'discogs.com/settings/developers → Generate new token. Con token las consultas son más rápidas y puedes ver el valor de tu colección. Se guarda solo en este dispositivo.'),
    field('Usuario', du), field('Token', dt),
    h('button', { class: 'btn', onclick: () => { prefs.set('discogs.user', du.value.trim()); prefs.set('discogs.token', dt.value.trim()); toast('Guardado'); } }, 'Guardar')));

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
    const entries = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) entries.push(...await readSpotifyZip(await f.arrayBuffer()));
      else { const j = JSON.parse(await f.text()); if (Array.isArray(j)) entries.push(...j); }
    }
    const { into, used, skipped } = C.aggregateHistory(entries, {});
    if (!Object.keys(into).length) throw new Error('No encontré reproducciones con álbum. Pide "Historial de reproducciones ampliado" (el normal no incluye álbum).');
    const months = Object.values(into).flatMap(a => Object.keys(a.months)).sort();
    const info = { albums: Object.keys(into).length, plays: used, from: months[0], to: months[months.length - 1], skipped };
    await store.set('history', into); await store.set('historyInfo', info);
    state.history = into; state.historyInfo = info;
    toast(`Historial importado: ${info.albums} álbumes`);
    go('ranking');
  } catch (e) { toast(e.message, true); setStatus(''); }
}

async function refreshApi() {
  try {
    const albums = await spotify.loadApiAlbums(m => setStatus(m));
    state.apiAlbums = albums; state.apiAt = Date.now();
    await store.set('api', { at: state.apiAt, albums });
    toast(`Spotify: ${Object.keys(albums).length} álbumes`);
    go('ranking');
  } catch (e) { toast(e.message, true); setStatus(''); }
}

// ---------- arranque ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await loadAll();
  markTab();
  render();
  // Vuelta del login de Spotify: ?code=…&state=…
  const qs = new URLSearchParams(location.search);
  if (qs.has('code') || qs.has('error')) {
    history.replaceState(null, '', location.pathname);
    try { await spotify.finishLogin(qs.toString()); toast('Spotify conectado'); await refreshApi(); }
    catch (e) { toast(e.message + ' Prueba "Si al volver de Spotify no entra solo" en Ajustes.', true); go('ajustes'); }
  } else if (fb.isLoggedIn()) {
    fb.readExtras().then(r => { if (!r.fromCache) { state.extras = r.albums; state.extrasAt = r.at; rebuildCollection(); render(); } }).catch(() => {});
  }
}
boot();
