import test from 'node:test';
import assert from 'node:assert/strict';

// Entorno de navegador simulado
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { origin: 'https://x.test', pathname: '/VinylTracker/', href: '' };
let sent, reply;
globalThis.fetch = async (url, opts) => { sent = Object.fromEntries(opts.body); return reply; };
const ok = { ok: true, status: 200, json: async () => ({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }) };

const S = await import('../js/spotify.js');
const stateOf = () => new URL(location.href).searchParams.get('state');
const back = (state, code = 'CODE1') => `https://x.test/VinylTracker/?code=${code}&state=${state}`;

test('pulsar "Conectar" varias veces no invalida los intentos anteriores', async () => {
  await S.startLogin(); const a = stateOf();
  await S.startLogin(); const b = stateOf();
  assert.notEqual(a, b);
  reply = ok;
  await S.finishLogin(back(a));          // el primero sigue siendo válido
  assert.equal(sent.grant_type, 'authorization_code');
  assert.equal(sent.redirect_uri, 'https://x.test/VinylTracker/');
  assert.ok(sent.code_verifier.length >= 43);
  assert.ok(S.isConnected());
  assert.equal(JSON.parse(store.get('vt.spotify.token')).refresh, 'ref');
});

test('acepta también solo la parte ?code=…&state=…', async () => {
  store.clear(); await S.startLogin(); const a = stateOf();
  reply = ok;
  await S.finishLogin(`code=X&state=${a}`);
  assert.ok(S.isConnected());
});

test('dirección recortada sin código: mensaje claro', async () => {
  store.clear(); await S.startLogin();
  await assert.rejects(() => S.finishLogin('https://x.test/VinylTracker/'), /no contiene el código/);
  assert.ok(!S.isConnected());
});

test('intento desconocido (otro dispositivo o caducado)', async () => {
  store.clear(); await S.startLogin();
  await assert.rejects(() => S.finishLogin(back('otro-estado')), /No encuentro ese intento/);
});

test('código ya usado o caducado (invalid_grant)', async () => {
  store.clear(); await S.startLogin(); const a = stateOf();
  reply = { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  await assert.rejects(() => S.finishLogin(back(a)), /ya se usó o caducó/);
  assert.ok(!S.isConnected());
});

test('Spotify rechaza el acceso (el usuario pulsó cancelar)', async () => {
  await assert.rejects(() => S.finishLogin('https://x.test/VinylTracker/?error=access_denied&state=x'), /rechazó el acceso/);
});

test('hasCode', () => {
  assert.ok(S.hasCode('https://x/?code=a&state=b'));
  assert.ok(S.hasCode('code=a&state=b'));
  assert.ok(!S.hasCode('https://x/VinylTracker/'));
});

test('buildLoginUrl (para abrir en Safari): no navega, guarda el intento y luego se puede completar', async () => {
  store.clear(); location.href = '';
  const url = await S.buildLoginUrl();
  assert.equal(location.href, '', 'no debe navegar');
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.test/VinylTracker/');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  reply = ok;
  await S.finishLogin(back(u.searchParams.get('state'), 'DESDE-SAFARI'));
  assert.equal(sent.code, 'DESDE-SAFARI');
  assert.ok(S.isConnected());
});
