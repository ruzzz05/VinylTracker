"""Conciertos próximos desde la API Discovery de Ticketmaster (clave gratuita en el secreto TICKETMASTER_KEY).

Se ejecuta en el servidor (GitHub Actions, a diario) y publica un JSON compacto con TODOS los conciertos de música
de los países elegidos. La app lo cruza en el móvil con tus artistas más escuchados, así que ni la clave ni tus
datos de escucha salen del dispositivo.
"""
import time
from datetime import datetime, timedelta, timezone

from .http import HttpError, get_json

API = "https://app.ticketmaster.com/discovery/v2/events.json"
PAGE = 200
DEEP_LIMIT = 1000          # Ticketmaster no deja paginar más allá de los primeros 1000 resultados de una consulta


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def compact(ev: dict):
    """Evento de Ticketmaster -> [id, nombre, fecha, hora, estado, sala, ciudad, país, url, [artistas]] | None"""
    start = (ev.get("dates") or {}).get("start") or {}
    date = start.get("localDate")
    code = (((ev.get("dates") or {}).get("status")) or {}).get("code", "").lower()
    emb = ev.get("_embedded") or {}
    acts = [a.get("name") for a in emb.get("attractions", []) if a.get("name")]
    if not date or not acts or code in ("cancelled", "canceled"):
        return None
    venue = (emb.get("venues") or [{}])[0]
    status = "postponed" if code in ("postponed", "rescheduled") else "offsale" if code == "offsale" else "ok"
    return [ev.get("id"), ev.get("name", ""), date, (start.get("localTime") or "")[:5], status,
            venue.get("name", ""), (venue.get("city") or {}).get("name", ""),
            (venue.get("country") or {}).get("countryCode", ""), ev.get("url", ""), acts[:8]]


def fetch_window(country, start, end, key, get=get_json, sleep=time.sleep):
    """Todos los eventos de música de un país entre dos fechas. -> (lista compacta, total que dice Ticketmaster)"""
    out, total, page = [], 0, 0
    while True:
        data = get(API, {"apikey": key, "countryCode": country, "classificationName": "music", "size": PAGE, "page": page,
                         "sort": "date,asc", "startDateTime": _iso(start), "endDateTime": _iso(end), "locale": "*"})
        info = data.get("page") or {}
        total = info.get("totalElements", 0)
        for ev in (data.get("_embedded") or {}).get("events", []):
            c = compact(ev)
            if c:
                out.append(c)
        page += 1
        if page >= info.get("totalPages", 0) or page * PAGE >= DEEP_LIMIT:
            return out, total
        sleep(0.25)


def fetch_country(country, start, end, key, get=get_json, sleep=time.sleep):
    """Si la ventana tiene más de 1000 resultados se parte por la mitad hasta que cabe."""
    sleep(0.25)
    events, total = fetch_window(country, start, end, key, get, sleep)
    if total <= DEEP_LIMIT or end - start <= timedelta(days=1):
        return events
    mid = start + (end - start) / 2
    return fetch_country(country, start, mid, key, get, sleep) + fetch_country(country, mid, end, key, get, sleep)


def build(key, countries, days=365, now=None, get=get_json, sleep=time.sleep, log=print):
    now = now or datetime.now(timezone.utc)
    seen, events, ok = set(), [], []
    for cc in countries:
        try:
            for e in fetch_country(cc, now, now + timedelta(days=days), key, get, sleep):
                if e[0] not in seen:
                    seen.add(e[0])
                    events.append(e)
            ok.append(cc)
            log(f"  {cc}: {len(events)} conciertos acumulados")
        except (HttpError, OSError) as ex:
            log(f"  ! {cc}: {ex}")
    events.sort(key=lambda e: (e[2], e[3]))
    return {"generated": now.isoformat(timespec="seconds"), "countries": ok, "events": events}
