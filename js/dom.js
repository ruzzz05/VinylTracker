// Utilidades de DOM compartidas. Todo con textContent: nada de HTML de terceros.
export function h(tag, props, ...kids) {
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

export const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');
// Para <img>: además de https admite imágenes incrustadas (data:image/…), que no sirven para enlaces
export const safeImg = u => (/^(https?:\/\/|data:image\/(png|jpeg|webp|gif|svg\+xml)[;,])/i.test(u || '') ? u : '#');

// ---------- Tooltip de los gráficos: un solo globo; en el móvil se abre al tocar y se cierra al tocar fuera ----------
let tip, tipAt = 0;
export function hideTip() { if (tip) tip.hidden = true; }

export function showTip(target, title, value) {
  if (!tip) {
    tip = h('div', { class: 'tip', role: 'status', hidden: true });
    document.body.append(tip);
    document.addEventListener('pointerdown', e => { if (!e.target.closest('[data-tip]')) hideTip(); }, true);
    window.addEventListener('scroll', () => { if (performance.now() - tipAt > 300) hideTip(); }, true);   // el scroll que provoca el propio toque (foco) no lo oculta
  }
  tip.replaceChildren(h('b', null, value), h('span', null, title));
  tip.hidden = false; tipAt = performance.now();
  const r = target.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const y = r.top - hgt - 8 > 8 ? r.top - hgt - 8 : r.bottom + 8;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

// Hace "tocable" un elemento: tooltip al tocar, al enfocar con teclado y al pasar el ratón
export function bindTip(node, title, value) {
  node.dataset.tip = '1'; node.tabIndex = 0;
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${title}: ${value}`);
  node.addEventListener('click', () => showTip(node, title, value));
  node.addEventListener('focus', () => showTip(node, title, value));
  node.addEventListener('blur', hideTip);
  node.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showTip(node, title, value); });
  node.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
  return node;
}
