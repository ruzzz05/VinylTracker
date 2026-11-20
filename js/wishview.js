// Pantallas de Deseos y Comprados (dentro de «Comprar»), búsqueda en Discogs y lector de código de barras.
// Recibe un `ctx` con lo que necesita de la app (estado, avisos, paneles); no toca nada más.
import { h, safeUrl } from './dom.js';
import * as C from './core.js';
import * as W from './wishlist.js';
import * as discogs from './discogs.js';
import * as B from './barcode.js';

const fmtDate = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------- acciones sobre la lista ----------
export function addItem(ctx, data) {
  const w = W.makeWish(data);
  if (!w) { ctx.toast('Faltan el artista y el nombre del disco', true); return null; }
  const r = W.addWish(ctx.state.wish, w);
  if (r.dup) {
    ctx.toast(r.item.status === 'bought' ? 'Ya lo tienes apuntado como comprado' : 'Ya está en tu lista de deseos', true);
    return null;
  }
  const first = W.checkItem(r.item, { storeIndex: ctx.state.storeIndex });          // primera comprobación: sin aviso
  ctx.state.wish = [first.item, ...ctx.state.wish];
  ctx.saveWish();
  ctx.toast(first.offers.length ? `Añadido. Ya está disponible en ${[...new Set(first.offers.map(o => o.store))].join(', ')}` : 'Añadido a deseos: te aviso cuando aparezca');
  ctx.refreshWish();
  return first.item;
}

export function buyItem(ctx, w, price) {
  ctx.state.wish = W.markBought(ctx.state.wish, w, { price });
  ctx.saveWish();
  ctx.toast('Apuntado como comprado (no se añade a la colección)');
  ctx.refreshWish();
}

export const undoBuy = (ctx, id) => { ctx.state.wish = W.unbuy(ctx.state.wish, id); ctx.saveWish(); ctx.refreshWish(); };
export const dropItem = (ctx, id) => { ctx.state.wish = W.removeWish(ctx.state.wish, id); ctx.saveWish(); ctx.refreshWish(); };

// ---------- piezas ----------
function cover(ctx, w) { return ctx.coverEl({ name: w.name, artist: w.artist, image: w.image }); }

function availability(ctx, w) {
  const offers = W.liveOffers(w, ctx.state.storeIndex);
  const chips = [];
  const best = C.bestOffer(offers);
  if (best) chips.push(h('span', { class: 'chip ok' }, `${best.preorder && !best.available ? 'Preventa' : 'En stock'} · ${best.store} ${C.money(best.price)}`));
  const dg = w.dg;
  if (dg && dg.forSale > 0) chips.push(h('span', { class: 'chip ok' }, `Discogs: ${dg.forSale} a la venta` + (dg.lowest != null ? ` desde ${C.money(dg.lowest)}` : '')));
  if (!chips.length) chips.push(h('span', { class: 'chip' }, w.checkedAt ? 'No disponible ahora' : 'Sin comprobar'));
  return chips;
}

function wishRow(ctx, w) {
  const bought = w.status === 'bought';
  return h('li', null, h('button', { class: 'row wrow', onclick: () => itemSheet(ctx, w.id) },
    cover(ctx, w),
    h('div', { class: 't' }, h('b', null, w.name), h('span', null, w.artist),
      bought ? h('span', { class: 'chip ok' }, `Comprado ${fmtDate(w.boughtAt)}` + (w.price != null ? ` · ${C.money(w.price)}` : ''))
        : h('div', { class: 'chips tight' }, availability(ctx, w))),
    w.kind === 'release' ? h('div', { class: 'm' }, h('b', null, 'Edición'), 'concreta') : null));
}

// ---------- listas ----------
export function wishView(ctx) {
  const root = h('div');
  const list = ctx.state.wish.filter(w => w.status === 'wanted');
  const live = x => W.liveOffers(x, ctx.state.storeIndex).length + (x.dg && x.dg.forSale > 0 ? 1 : 0);
  list.sort((a, b) => (live(b) > 0) - (live(a) > 0) || b.addedAt - a.addedAt);

  root.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => addSheet(ctx) }, '+ Añadir vinilo'),
    h('button', { class: 'btn sec', onclick: () => scanSheet(ctx) }, 'Escanear código')));
  root.append(notifyCard(ctx));
  if (!list.length) {
    root.append(h('div', { class: 'empty' }, h('p', null, 'Aquí van los vinilos que quieres, sean un álbum cualquiera o una edición concreta.'),
      h('p', { class: 'muted' }, 'Te aviso cuando aparezcan en stock o en preventa en las tiendas, o cuando haya copias a la venta en Discogs.')));
    return root;
  }
  const n = list.filter(w => live(w) > 0).length;
  root.append(h('p', { class: 'muted' }, n ? `${n} disponible${n === 1 ? '' : 's'} ahora. ` : '',
    'Se comprueba al abrir la app y cada 30 min mientras está abierta (las tiendas se actualizan cada día).'));
  root.append(h('ul', { class: 'list' }, list.map(w => wishRow(ctx, w))));
  return root;
}

export function boughtView(ctx) {
  const list = ctx.state.wish.filter(w => w.status === 'bought').sort((a, b) => b.boughtAt - a.boughtAt);
  if (!list.length) return h('div', { class: 'empty' }, h('p', null, 'Todavía no has marcado ningún vinilo como comprado.'),
    h('p', { class: 'muted' }, 'Sirve para apuntar lo que ya has comprado sin añadirlo a la colección: deja de salir en las sugerencias.'));
  return h('div', null, h('p', { class: 'muted' }, `${list.length} comprado${list.length === 1 ? '' : 's'}, aún fuera de la colección.`), h('ul', { class: 'list' }, list.map(w => wishRow(ctx, w))));
}

// Avisos del sistema (opcionales). En iPhone solo funcionan con la app instalada y siempre mientras está abierta.
function notifyCard(ctx) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
    return typeof Notification !== 'undefined' && Notification.permission === 'denied'
      ? h('p', { class: 'muted' }, 'Avisos del sistema bloqueados: se avisa dentro de la app.') : null;
  }
  return h('div', { class: 'card' }, h('h3', null, 'Avisos'),
    h('p', { class: 'muted' }, 'Los avisos salen dentro de la app. Si quieres que también suenen como notificación, actívalos.'),
    h('button', { class: 'btn sec', onclick: async () => { try { await Notification.requestPermission(); } catch (e) { /* ignorado */ } ctx.render(); } }, 'Activar notificaciones'));
}

// ---------- ficha de un elemento ----------
export function itemSheet(ctx, id) {
  const w = W.find(ctx.state.wish, id);
  if (!w) return;
  const offers = W.liveOffers(w, ctx.state.storeIndex);
  const price = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Precio pagado (opcional)', autocomplete: 'off' });
  const bought = w.status === 'bought';
  const dgUrl = w.discogsId ? `https://www.discogs.com/release/${w.discogsId}` : '';
  ctx.showPanel(
    h('div', { class: 'head' }, cover(ctx, w), h('div', null, h('h2', null, w.name), h('p', { class: 'muted' }, w.artist),
      w.detail ? h('span', { class: 'chip' }, w.detail) : null)),
    bought
      ? h('div', { class: 'card' }, h('h3', null, 'Comprado'), h('p', null, `${fmtDate(w.boughtAt)}` + (w.price != null ? ` · ${C.money(w.price)}` : '')),
        h('p', { class: 'muted' }, 'No está en tu colección: solo anotado como comprado.'))
      : h('div', { class: 'card' }, h('h3', null, 'Disponibilidad'),
        offers.length ? offers.map(o => h('div', { class: 'offer' },
          h('div', null, h('b', null, o.store), h('small', null, o.title)),
          h('div', { style: 'text-align:right' }, h('b', null, C.money(o.price)), h('small', { class: 'own' }, o.preorder && !o.available ? 'Preventa' : 'En stock'),
            h('a', { href: safeUrl(o.url), target: '_blank', rel: 'noopener' }, 'Abrir'))))
          : h('p', { class: 'muted' }, 'Ahora mismo no está en Universal Music Online ni en Apparell.'),
        w.dg && w.dg.forSale > 0 ? h('div', { class: 'stat' }, h('span', null, 'Discogs'), h('b', null, `${w.dg.forSale} a la venta` + (w.dg.lowest != null ? ` desde ${C.money(w.dg.lowest)}` : ''))) : null,
        h('div', { class: 'offer' }, h('div', null, h('b', null, 'Fnac'), h('small', null, 'Búscalo a mano')), h('a', { href: C.fnacUrl(w), target: '_blank', rel: 'noopener' }, 'Buscar'))),
    bought ? null : [h('label', null, 'Al comprarlo'), price],
    h('div', { class: 'btns' },
      bought ? h('button', { class: 'btn', onclick: () => { undoBuy(ctx, w.id); ctx.closeSheet(); } }, 'Volver a deseos')
        : h('button', { class: 'btn', onclick: () => { buyItem(ctx, w, price.value.replace(',', '.')); ctx.closeSheet(); } }, 'Ya lo compré'),
      dgUrl ? h('a', { class: 'btn sec', href: dgUrl, target: '_blank', rel: 'noopener' }, 'Ver en Discogs') : null,
      h('button', { class: 'btn danger', onclick: () => { if (confirm('¿Quitar de la lista?')) { dropItem(ctx, w.id); ctx.closeSheet(); } } }, 'Quitar'),
      h('button', { class: 'btn sec', onclick: ctx.closeSheet }, 'Cerrar')));
}

// Botones de la ficha de un álbum (Ranking / Comprar): quiero / ya lo compré
export function wishButtons(ctx, r, repaint) {
  const w = W.find(ctx.state.wish, W.wishId({ kind: 'album', artist: r.artist, name: r.name }))
    || ctx.state.wish.find(x => C.albumKey(x.artist, x.name) === C.albumKey(r.artist, r.name));
  const data = { kind: 'album', artist: r.artist, name: r.name, image: r.image };
  const after = () => repaint();
  if (w && w.status === 'bought') return h('div', { class: 'card' }, h('span', { class: 'chip ok' }, '✓ Comprado (fuera de la colección)'),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec sm', onclick: () => { undoBuy(ctx, w.id); after(); } }, 'Deshacer')));
  if (w) return h('div', { class: 'card' }, h('span', { class: 'chip ok' }, '♡ En tu lista de deseos'),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec sm', onclick: () => { buyItem(ctx, w, null); after(); } }, 'Ya lo compré'),
      h('button', { class: 'btn danger sm', onclick: () => { dropItem(ctx, w.id); after(); } }, 'Quitar')));
  return h('div', { class: 'btns' },
    h('button', { class: 'btn sec', onclick: () => { if (addItem(ctx, data)) after(); } }, '♡ Lo quiero'),
    h('button', { class: 'btn sec', onclick: () => { buyItem(ctx, W.makeWish(data), null); after(); } }, '✓ Ya lo compré'));
}

// ---------- resultados de Discogs (búsqueda y código de barras) ----------
function resultCard(ctx, r, { barcode = '' } = {}) {
  const owned = C.isOwned({ artist: r.artist, name: r.name, key: C.albumKey(r.artist, r.name) }, ctx.state.owned);
  const have = W.find(ctx.state.wish, 'r' + r.discogsId) || ctx.state.wish.find(x => C.albumKey(x.artist, x.name) === C.albumKey(r.artist, r.name) && x.kind === 'album');
  const rel = { kind: 'release', discogsId: r.discogsId, artist: r.artist, name: r.name, image: r.image, detail: r.detail, barcode: barcode || r.barcode };
  return h('div', { class: 'card rescard' },
    h('div', { class: 'head' }, cover(ctx, r), h('div', null, h('b', null, r.name), h('p', { class: 'muted' }, r.artist), r.detail ? h('small', { class: 'muted' }, r.detail) : null,
      !r.isVinyl ? h('small', { class: 'bad' }, ' · no es vinilo') : null)),
    owned ? h('p', { class: 'own' }, '✓ Ya está en tu colección') : null,
    have ? h('p', { class: 'muted' }, have.status === 'bought' ? 'Ya lo tienes apuntado como comprado.' : 'Ya está en tu lista de deseos.') : null,
    h('div', { class: 'btns' },
      h('button', { class: 'btn sm', onclick: e => { if (addItem(ctx, rel)) e.target.closest('.rescard').querySelector('.btns').replaceChildren(h('span', { class: 'chip ok' }, '♡ Añadido')); } }, '♡ Esta edición'),
      h('button', { class: 'btn sec sm', onclick: e => { if (addItem(ctx, { ...rel, kind: 'album', discogsId: 0, detail: '' })) e.target.closest('.rescard').querySelector('.btns').replaceChildren(h('span', { class: 'chip ok' }, '♡ Añadido')); } }, 'Cualquier edición'),
      h('button', { class: 'btn sec sm', onclick: e => { buyItem(ctx, W.makeWish(rel), null); e.target.closest('.rescard').querySelector('.btns').replaceChildren(h('span', { class: 'chip ok' }, '✓ Comprado')); } }, 'Ya lo compré')));
}

const needToken = () => h('p', { class: 'muted bad' }, 'Discogs necesita tu token para buscar: añádelo en Ajustes → Discogs.');

// ---------- añadir a mano o buscando ----------
export function addSheet(ctx) {
  const q = h('input', { type: 'search', placeholder: 'Artista y álbum (p. ej. Nirvana Nevermind)', autocomplete: 'off', enterkeyhint: 'search' });
  const out = h('div'), status = h('p', { class: 'muted', role: 'status' });
  const search = async () => {
    const text = q.value.trim();
    if (!text) return;
    if (!discogs.hasToken()) { out.replaceChildren(needToken()); return; }
    status.textContent = 'Buscando en Discogs…'; out.replaceChildren();
    try {
      const res = W.sortResults(await discogs.searchReleases(text)).slice(0, 12);
      status.textContent = res.length ? 'Elige una edición concreta o «Cualquier edición» si te vale cualquiera.' : 'Discogs no encontró nada. Prueba con menos palabras o añádelo a mano abajo.';
      out.replaceChildren(...res.map(r => resultCard(ctx, r)));
    } catch (e) { status.textContent = e.message; status.className = 'muted bad'; }
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  const artist = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'Artista' });
  const name = h('input', { type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'Álbum' });
  ctx.showPanel(h('h2', null, 'Añadir a deseos'),
    h('label', null, 'Buscar en Discogs'), q,
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: search }, 'Buscar'), h('button', { class: 'btn sec', onclick: () => scanSheet(ctx) }, 'Escanear código')),
    status, out,
    h('details', null, h('summary', { class: 'muted' }, 'O escríbelo a mano (cualquier edición)'),
      h('label', null, 'Artista'), artist, h('label', null, 'Álbum'), name,
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { if (addItem(ctx, { kind: 'album', artist: artist.value, name: name.value })) ctx.closeSheet(); } }, 'Añadir álbum'))),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: ctx.closeSheet }, 'Cerrar')));
}

// ---------- lector de código de barras ----------
export function scanSheet(ctx) {
  const video = h('video', { class: 'scanvideo', playsinline: '', muted: '', hidden: true });
  const frame = h('div', { class: 'scanframe', hidden: true }, video, h('i', { class: 'scanline' }));
  const status = h('p', { class: 'muted', role: 'status' }, 'Apunta la cámara al código de barras de la contraportada.');
  const out = h('div');
  const manual = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'o escríbelo: 602537…', autocomplete: 'off', maxlength: '20' });
  let handle = null;
  const stop = () => { if (handle) { handle.stop(); handle = null; } ctx.state.scanStop = null; frame.hidden = true; };
  ctx.state.scanStop = stop;

  async function lookup(raw) {
    const code = B.normalizeBarcode(raw);
    if (!code) { status.textContent = 'Ese código no es válido (revisa las cifras).'; status.className = 'muted bad'; return; }
    stop(); status.className = 'muted'; status.textContent = `Código ${code}: buscando en Discogs…`; out.replaceChildren();
    if (!discogs.hasToken()) { status.textContent = `Código ${code}.`; out.replaceChildren(needToken()); return; }
    try {
      let raw = [];
      for (const v of B.barcodeVariants(code)) { raw = await discogs.searchBarcode(v); if (raw.length) break; }
      const res = W.sortResults(raw).slice(0, 8);
      status.textContent = res.length ? `Código ${code}: ${res.length === 1 ? 'esta es la edición' : 'estas son las ediciones'}.` : `Código ${code}: Discogs no lo conoce.`;
      out.replaceChildren(...res.map(r => resultCard(ctx, r, { barcode: code })),
        h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => { out.replaceChildren(); start(); } }, 'Escanear otro')));
    } catch (e) { status.textContent = e.message; status.className = 'muted bad'; }
  }

  async function start() {
    status.className = 'muted'; status.textContent = 'Abriendo la cámara…';
    frame.hidden = false; video.hidden = false;
    try { handle = await B.startScanner(video, lookup); status.textContent = 'Apunta la cámara al código de barras de la contraportada.'; }
    catch (e) {
      frame.hidden = true; handle = null;
      status.className = 'muted bad';
      status.textContent = e.name === 'NotAllowedError' ? 'No hay permiso para la cámara. Actívalo en Ajustes del iPhone → Safari/VinylTracker, o escribe el código.' : (e.message || 'No se pudo abrir la cámara.');
    }
  }

  manual.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookup(manual.value); } });
  ctx.showPanel(h('h2', null, 'Escanear código de barras'), frame, status,
    B.cameraSupported() ? h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: start }, 'Abrir cámara')) : null,
    h('label', null, 'Código a mano'), manual,
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => lookup(manual.value) }, 'Buscar código')),
    out,
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => { stop(); ctx.closeSheet(); } }, 'Cerrar')));
  if (B.cameraSupported()) start();
}
