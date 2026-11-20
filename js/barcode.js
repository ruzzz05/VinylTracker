// Códigos de barras: validación (pura) y lectura con la cámara.
// Con BarcodeDetector (Chrome / Android) se usa el del navegador; en Safari de iPhone se carga ZXing (js/vendor/zxing.min.js) al escanear.

// Solo cifras, 8 / 12 / 13 / 14 (EAN-8, UPC-A, EAN-13, GTIN-14), con dígito de control correcto. -> '602445790401' | null
export function normalizeBarcode(text) {
  const d = String(text || '').replace(/[\s\-.]/g, '');
  if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return null;
  const digits = [...d].map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? d : null;
}

// Discogs guarda unos códigos como UPC (12) y otros como EAN (13, con un 0 delante): se prueban las dos formas
export function barcodeVariants(code) {
  const d = normalizeBarcode(code);
  if (!d) return [];
  const out = [d];
  if (d.length === 12) out.push('0' + d);
  if (d.length === 13 && d[0] === '0') out.push(d.slice(1));
  return out;
}

// ---------- cámara ----------
const FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e'];

let zxingP;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingP) zxingP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('vendor/zxing.min.js', import.meta.url).href;
    s.onload = () => (window.ZXing ? res(window.ZXing) : rej(new Error('No se pudo cargar el lector de códigos')));
    s.onerror = () => { zxingP = null; rej(new Error('No se pudo cargar el lector de códigos (¿sin conexión?)')); };
    document.head.append(s);
  });
  return zxingP;
}

export const cameraSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// Abre la cámara trasera dentro de `video` y llama a onCode(código) con cada lectura válida y distinta.
// Devuelve { stop() }. Lanza si no hay permiso o cámara.
export async function startScanner(video, onCode) {
  if (!cameraSupported()) throw new Error('Este navegador no deja usar la cámara. Escribe el código a mano.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
  await video.play().catch(() => {});
  let stopped = false, last = '', lastAt = 0;
  const stop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  const emit = raw => {
    const code = normalizeBarcode(raw);
    if (!code || (code === last && Date.now() - lastAt < 3000)) return;
    last = code; lastAt = Date.now(); onCode(code);
  };

  let detect;
  if ('BarcodeDetector' in window) {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) });
      detect = async () => { const r = await det.detect(video); if (r[0]) emit(r[0].rawValue); };
    } catch (e) { detect = null; }
  }
  if (!detect) {
    const Z = await loadZxing();
    const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_E]],
      [Z.DecodeHintType.TRY_HARDER, true]]);
    const reader = new Z.MultiFormatReader(); reader.setHints(hints);
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      const w = video.videoWidth, hgt = video.videoHeight;
      if (!w) return;
      // franja central: el código ocupa el centro y así se decodifica antes
      const sw = Math.round(w * 0.9), sh = Math.round(hgt * 0.5), sx = Math.round((w - sw) / 2), sy = Math.round((hgt - sh) / 2);
      canvas.width = sw; canvas.height = sh;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
      const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
      try { emit(reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src))).getText()); }
      catch (e) { /* ningún código en este fotograma */ }
    };
  }
  (async function loop() {
    while (!stopped) { try { await detect(); } catch (e) { /* fotograma sin código */ } await new Promise(r => setTimeout(r, 180)); }
  })();
  return { stop };
}
