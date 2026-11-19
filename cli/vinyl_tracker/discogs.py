"""Discogs: precio de mercado en vinilo, copias a la venta, comunidad y valor de tu colección."""
import os

from .http import HttpError, cached_json
from .models import Album
from .text import clean_album, overlap, tokens

API = "https://api.discogs.com"
PAUSE = 1.1 if os.environ.get("DISCOGS_TOKEN") else 2.6   # límite 60/min con token, 25/min sin él


def _headers():
    t = os.environ.get("DISCOGS_TOKEN")
    return {"Authorization": f"Discogs token={t}"} if t else {}


def _get(path, ttl=6 * 3600, **params):
    return cached_json(API + path, params, _headers(), ttl=ttl, pause=PAUSE)


def pick_release(results: list, artist: str, album: str):
    """Elige la edición en vinilo que más coincide; desempata por popularidad (have)."""
    a_t, b_t = tokens(artist), tokens(clean_album(album))
    best, best_score = None, 0.0
    for r in results:
        title_tokens = set(tokens(r.get("title", "")))
        s = overlap(b_t, title_tokens) * 0.6 + overlap(a_t, title_tokens) * 0.4
        s += min((r.get("community") or {}).get("have", 0), 100000) / 1e7   # desempate
        if s > best_score:
            best, best_score = r, s
    if best and best_score >= 0.75:
        return best
    return None


def lookup(album: Album, currency: str = "EUR") -> Album:
    album.currency = currency
    try:
        res = _get("/database/search", type="release", format="Vinyl", artist=album.artist,
                   release_title=clean_album(album.album), per_page=15)["results"]
        hit = pick_release(res, album.artist, album.album)
        if not hit:
            return album
        rid = hit["id"]
        album.discogs_id = rid
        album.discogs_url = f"https://www.discogs.com/release/{rid}"
        comm = hit.get("community") or {}
        album.discogs_have, album.discogs_want = comm.get("have"), comm.get("want")
        st = _get(f"/marketplace/stats/{rid}", ttl=3600, curr_abbr=currency)
        lp = st.get("lowest_price")
        album.discogs_lowest = lp["value"] if isinstance(lp, dict) else lp
        album.discogs_for_sale = st.get("num_for_sale")
        if os.environ.get("DISCOGS_TOKEN"):
            try:    # solo funciona si tu cuenta tiene perfil de vendedor
                ps = _get(f"/marketplace/price_suggestions/{rid}", ttl=24 * 3600)
                album.discogs_vgplus = _val(ps, "Very Good Plus (VG+)")
                album.discogs_nm = _val(ps, "Near Mint (NM or M-)")
            except HttpError:
                pass
    except HttpError as e:
        print(f"  ! Discogs {e.status} para {album.artist} - {album.album}")
    return album


def _val(d, key):
    v = (d or {}).get(key)
    return round(v["value"], 2) if isinstance(v, dict) and "value" in v else None


def collection(username: str, currency: str = "EUR") -> dict:
    """Valor de tu colección (requiere DISCOGS_TOKEN) y set de ids que ya tienes."""
    ids, page = set(), 1
    while True:
        d = _get(f"/users/{username}/collection/folders/0/releases", ttl=600, per_page=100, page=page)
        for r in d["releases"]:
            ids.add(r["id"])
        if page >= d["pagination"]["pages"]:
            break
        page += 1
    try:
        value = _get(f"/users/{username}/collection/value", ttl=600)
    except HttpError:
        value = {}
    return {"ids": ids, "value": value, "count": len(ids)}
