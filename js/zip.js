// Lector mínimo de .zip (método "stored" y "deflate") para el export de Spotify, sin librerías.
// Usa DecompressionStream('deflate-raw'), disponible en Safari 16.4+ y navegadores actuales.

const u16 = (d, o) => d.getUint16(o, true);
const u32 = (d, o) => d.getUint32(o, true);

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// Devuelve [{ name, read() -> Promise<Uint8Array> }]
export function listZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const d = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No parece un .zip válido');
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
    entries.push(...JSON.parse(text));
  }
  return entries;
}
