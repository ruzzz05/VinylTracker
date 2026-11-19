"""Cliente HTTP mínimo (solo librería estándar) con reintentos y caché en disco."""
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = "vinyl-tracker/0.1"
CACHE_DIR = Path(".cache")


class HttpError(Exception):
    def __init__(self, status: int, url: str, body: str = ""):
        super().__init__(f"HTTP {status} en {url}")
        self.status, self.url, self.body = status, url, body


def request(url, params=None, headers=None, data=None, retries=3, timeout=30):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers=h, data=body)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < retries:
                wait = int(e.headers.get("Retry-After", 2 ** (attempt + 1)))
                time.sleep(min(wait, 30))
                continue
            raise HttpError(e.code, url, e.read().decode("utf-8", "replace")) from None
        except urllib.error.URLError:
            if attempt == retries:
                raise
            time.sleep(2 ** attempt)


def get_json(url, params=None, headers=None, data=None, **kw):
    return json.loads(request(url, params, headers, data, **kw))


def cached_json(url, params=None, headers=None, ttl=6 * 3600, pause=0.0):
    """get_json con caché en .cache/ (la clave NO incluye cabeceras/tokens)."""
    key = hashlib.sha1((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()
    f = CACHE_DIR / f"{key}.json"
    if f.exists() and time.time() - f.stat().st_mtime < ttl:
        return json.loads(f.read_text())
    if pause:
        time.sleep(pause)
    out = get_json(url, params, headers)
    CACHE_DIR.mkdir(exist_ok=True)
    f.write_text(json.dumps(out))
    return out
