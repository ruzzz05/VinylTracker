// Color de ambiente: cada pantalla toma el color dominante de la portada que la protagoniza (Tinta).
// Las funciones puras se prueban con `node --test tests/`; la lectura de píxeles solo existe en el navegador.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex2 = n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// Ajusta un color para que sirva de ambiente sobre fondo oscuro o claro: ni gris ni quemado, con luminosidad controlada
export function normalizeTint(rgb, { min = 0.4, max = 0.58 } = {}) {
  const [h, s, l] = rgbToHsl(rgb);
  return toHex(hslToRgb([h, clamp(s, 0.5, 0.85), clamp(l, min, max)]));
}

// Color dominante de una imagen (píxeles RGBA): se cuentan por tono los píxeles vivos y se descartan los casi negros, casi blancos y grises.
// -> [r, g, b] | null (si la imagen es toda gris, negra o blanca)
export function dominant(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]], [h, s, l] = rgbToHsl(rgb);
    if (l < 0.12 || l > 0.92 || s < 0.18) continue;
    const key = Math.floor(h / 20) % 18, w = s * (1 - Math.abs(l - 0.5));
    const b = buckets.get(key) || { w: 0, r: 0, g: 0, bl: 0 };
    b.w += w; b.r += rgb[0] * w; b.g += rgb[1] * w; b.bl += rgb[2] * w;
    buckets.set(key, b);
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b.w > best.w) best = b;
  return best && best.w > 0 ? [best.r / best.w, best.g / best.w, best.bl / best.w] : null;
}

// Color estable a partir de un texto (para portadas sin imagen o sin leer)
export function hashTint(text) {
  let h = 5381;
  for (const c of String(text || '')) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return toHex(hslToRgb([Math.abs(h) % 360, 0.62, 0.5]));
}

export const DEFAULT_TINT = '#2a9d8f';

// ---------- navegador ----------
const mem = new Map();

// Lee el color de una imagen (dirección o blob). -> '#rrggbb' | null
export function tintFromImage(url) {
  if (!url) return Promise.resolve(null);
  if (mem.has(url)) return Promise.resolve(mem.get(url));
  return new Promise(res => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 24;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 24);
        const d = dominant(x.getImageData(0, 0, 24, 24).data);
        const hex = d ? normalizeTint(d) : null;
        mem.set(url, hex); res(hex);
      } catch (e) { mem.set(url, null); res(null); }       // imagen sin CORS: no se puede leer
    };
    img.onerror = () => { mem.set(url, null); res(null); };
    img.src = url;
  });
}

export const peekTint = url => mem.get(url);
