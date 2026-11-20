// Lector mínimo de .zip (método "stored" y "deflate") para el export de Spotify, sin librerías.
// Usa DecompressionStream('deflate-raw'), disponible en Safari 16.4+ y navegadores actuales.

const u16 = (d, o) => d.getUint16(o, true);
const u32 = (d, o) => d.getUint32(o, true);

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// Busca la firma "PK\x07\x08" (cierre de un archivo con tamaño al final) a partir de `from`
function indexOfDescriptor(bytes, from) {
  for (let i = bytes.indexOf(0x50, from); i >= 0 && i + 4 <= bytes.length; i = bytes.indexOf(0x50, i + 1)) {
    if (bytes[i + 1] === 0x4b && bytes[i + 2] === 0x07 && bytes[i + 3] === 0x08) return i;
  }
  return -1;
}

// Recuperación sin directorio central: recorre las cabeceras locales. Los archivos "en flujo" (bit 3) llevan sus
// tamaños tras los datos; se localizan buscando el cierre cuyo tamaño comprimido coincide con lo recorrido.
// Un archivo cortado a medias se descarta; los completos se conservan.
function scanLocalEntries(buffer) {
  const bytes = new Uint8Array(buffer), d = new DataView(buffer), dec = new TextDecoder();
  const files = [];
  let pos = 0;
  while (pos + 30 <= bytes.length && u32(d, pos) === 0x04034b50) {
    const flag = u16(d, pos + 6), method = u16(d, pos + 8), csize = u32(d, pos + 18);
    const nlen = u16(d, pos + 26), xlen = u16(d, pos + 28);
    const name = dec.decode(bytes.subarray(pos + 30, pos + 30 + nlen));
    const start = pos + 30 + nlen + xlen;
    let end = -1, next = -1;
    if (flag & 8) {
      for (let p = indexOfDescriptor(bytes, start); p >= 0 && p + 16 <= bytes.length; p = indexOfDescriptor(bytes, p + 1)) {
        if (u32(d, p + 8) === p - start) { end = p; next = p + 16; break; }
      }
    } else { end = start + csize; next = end; }
    if (end < 0 || end > bytes.length) break;
    files.push({
      name,
      async read() {
        const raw = bytes.subarray(start, end);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error('Compresión de zip no soportada: ' + method);
      }
    });
    pos = next;
  }
  return files;
}

// Devuelve [{ name, read() -> Promise<Uint8Array> }]
export function listZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const d = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    // Zip cortado (descarga o subida incompleta): sin directorio central. Se recuperan los archivos completos uno a uno.
    const found = scanLocalEntries(buffer);
    if (found.length) return found;
    throw new Error('No parece un .zip válido');
  }
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const dec = new TextDecoder();
  const files = [];
  for (let n = 0; n < count; n++) {
    if (u32(d, p) !== 0x02014b50) throw new Error('Directorio del zip dañado');
    const method = u16(d, p + 10), csize = u32(d, p + 20);
    const nlen = u16(d, p + 28), xlen = u16(d, p + 30), clen = u16(d, p + 32), off = u32(d, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    files.push({
      name,
      async read() {
        const lh = off;
        const start = lh + 30 + u16(d, lh + 26) + u16(d, lh + 28);
        const raw = bytes.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error('Compresión de zip no soportada: ' + method);
      }
    });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// Lee solo los Streaming_History_Audio*.json de un zip y devuelve un array de entradas
export async function readSpotifyZip(buffer) {
  const entries = [];
  for (const f of listZip(buffer)) {
    // Historial ampliado (Streaming_History_Audio_*) o paquete básico (StreamingHistory0.json / StreamingHistory_music_0.json)
    if (!/(Streaming_History_Audio[^/]*|StreamingHistory(_music)?_?\d*)\.json$/.test(f.name)) continue;
    const text = new TextDecoder().decode(await f.read());
    for (const e of JSON.parse(text)) entries.push(e);          // (sin spread: con muchas entradas desbordaría la pila)
  }
  return entries;
}
