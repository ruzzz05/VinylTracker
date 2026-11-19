"""API web de Spotify: login PKCE (sin client secret), top tracks, recientes y álbumes guardados."""
import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path

from .http import HttpError, get_json
from .models import Album
from .text import album_key

API = "https://api.spotify.com/v1"
AUTH = "https://accounts.spotify.com"
REDIRECT = "http://127.0.0.1:8888/callback"
SCOPES = "user-top-read user-read-recently-played user-library-read"
TOKEN_FILE = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "vinyl-tracker" / "spotify.json"


def login(client_id: str) -> None:
    """Abre el navegador, recibe el código en localhost y guarda tokens (con refresh)."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(12)
    got = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Listo, puedes cerrar esta pestaña.".encode())

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 8888), H)
    url = f"{AUTH}/authorize?" + urllib.parse.urlencode({
        "client_id": client_id, "response_type": "code", "redirect_uri": REDIRECT,
        "scope": SCOPES, "state": state, "code_challenge_method": "S256", "code_challenge": challenge})
    print("Abre esta URL si no se abre sola:\n", url)
    webbrowser.open(url)
    t = threading.Thread(target=srv.handle_request)
    t.start()
    t.join(timeout=300)
    srv.server_close()
    if got.get("state") != state or "code" not in got:
        raise SystemExit(f"Login fallido: {got.get('error', 'sin respuesta')}")
    tok = get_json(f"{AUTH}/api/token", data={
        "grant_type": "authorization_code", "code": got["code"], "redirect_uri": REDIRECT,
        "client_id": client_id, "code_verifier": verifier})
    _save(tok, client_id)
    print(f"Token guardado en {TOKEN_FILE}")


def _save(tok: dict, client_id: str) -> None:
    prev = json.loads(TOKEN_FILE.read_text()) if TOKEN_FILE.exists() else {}
    data = {"client_id": client_id,
            "access_token": tok["access_token"],
            "refresh_token": tok.get("refresh_token", prev.get("refresh_token")),
            "expires_at": time.time() + tok.get("expires_in", 3600) - 60}
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(data))
    TOKEN_FILE.chmod(0o600)


def access_token() -> str:
    if os.environ.get("SPOTIFY_TOKEN"):
        return os.environ["SPOTIFY_TOKEN"]
    if not TOKEN_FILE.exists():
        raise SystemExit("Sin token de Spotify. Ejecuta `python -m vinyl_tracker auth-spotify` o define SPOTIFY_TOKEN.")
    d = json.loads(TOKEN_FILE.read_text())
    if time.time() >= d["expires_at"]:
        tok = get_json(f"{AUTH}/api/token", data={
            "grant_type": "refresh_token", "refresh_token": d["refresh_token"], "client_id": d["client_id"]})
        _save(tok, d["client_id"])
        d = json.loads(TOKEN_FILE.read_text())
    return d["access_token"]


def _get(path, **params):
    return get_json(f"{API}{path}", params, {"Authorization": f"Bearer {access_token()}"})


def _add(albums, album_obj, source, plays=0):
    if not album_obj or album_obj.get("album_type") == "single" and album_obj.get("total_tracks", 2) < 3:
        return
    artist = album_obj["artists"][0]["name"]
    k = album_key(artist, album_obj["name"])
    a = albums.setdefault(k, Album(artist=artist, album=album_obj["name"]))
    a.sources.add(source)
    a.plays += plays
    return a


def load_api_albums(albums: dict | None = None) -> dict:
    """Completa/crea álbumes con: top tracks (3 rangos), recientes y álbumes guardados.

    Spotify no da minutos reales: aquí 'plays' son puntos aproximados
    (pesan más las canciones del top a corto plazo). Úsalo como complemento al historial.
    """
    albums = albums if albums is not None else {}
    weights = {"short_term": 3, "medium_term": 2, "long_term": 1}
    for rng, w in weights.items():
        for offset in (0, 50):
            try:
                items = _get("/me/top/tracks", time_range=rng, limit=50, offset=offset)["items"]
            except HttpError as e:
                raise SystemExit(f"Spotify rechazó la petición ({e.status}). ¿Token caducado o sin permisos?") from e
            for rank, tr in enumerate(items):
                _add(albums, tr["album"], "api", plays=w * (100 - offset - rank) // 10)
    for it in _get("/me/player/recently-played", limit=50).get("items", []):
        a = _add(albums, it["track"]["album"], "api", plays=1)
        if a:
            a.last_played = max(a.last_played, it["played_at"])
    offset = 0
    while offset < 500:
        page = _get("/me/albums", limit=50, offset=offset)
        for it in page["items"]:
            _add(albums, it["album"], "guardado")
        if not page.get("next"):
            break
        offset += 50
    return albums
