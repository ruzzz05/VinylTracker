"""Lee el export de Spotify (Privacidad -> 'Descargar tus datos').

Soporta el 'Extended streaming history' (Streaming_History_Audio_*.json, con álbum)
desde carpeta o .zip. El formato antiguo StreamingHistory*.json NO trae álbum y se omite.
"""
import json
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import Album
from .text import album_key

MIN_MS = 30_000  # Spotify cuenta una reproducción a partir de 30 s


def _iter_json_blobs(path: Path):
    if path.is_file() and path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            for n in sorted(z.namelist()):
                if n.endswith(".json") and "Streaming_History_Audio" in n:
                    yield n, json.loads(z.read(n))
    elif path.is_dir():
        for f in sorted(path.rglob("Streaming_History_Audio*.json")):
            yield f.name, json.loads(f.read_text(encoding="utf-8"))
    elif path.is_file():
        yield path.name, json.loads(path.read_text(encoding="utf-8"))
    else:
        raise FileNotFoundError(path)


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load_history(path, days: int | None = 365, now: datetime | None = None):
    """Devuelve (dict clave->Album, resumen)."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days) if days else None
    albums: dict[str, Album] = {}
    track_sets: dict[str, set] = defaultdict(set)
    total = used = no_album = 0
    for _, blob in _iter_json_blobs(Path(path)):
        for e in blob:
            total += 1
            artist = e.get("master_metadata_album_artist_name")
            album = e.get("master_metadata_album_album_name")
            if not artist or not album:
                no_album += 1       # podcasts, formato antiguo, etc.
                continue
            ms = e.get("ms_played") or 0
            ts = _parse_ts(e["ts"]) if e.get("ts") else None
            if cutoff and ts and ts < cutoff:
                continue
            k = album_key(artist, album)
            a = albums.setdefault(k, Album(artist=artist, album=album, sources={"historial"}))
            a.minutes += ms / 60000
            if ms >= MIN_MS:
                a.plays += 1
                used += 1
            track_sets[k].add(e.get("spotify_track_uri") or e.get("master_metadata_track_name"))
            if ts and ts.isoformat() > a.last_played:
                a.last_played = ts.isoformat()
    for k, a in albums.items():
        a.tracks = len(track_sets[k])
        a.minutes = round(a.minutes, 1)
    return albums, {"entradas": total, "reproducciones_contadas": used, "sin_album": no_album}
