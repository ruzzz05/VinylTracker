"""Informe en Markdown, CSV y HTML."""
import csv
import html
from pathlib import Path

from .models import Album


def _price(v, cur):
    return f"{v:.2f} {cur}" if v is not None else "—"


def best_offer(a: Album):
    real = [o for o in a.offers if o.price is not None and o.store != "Fnac"]
    avail = [o for o in real if o.available or o.preorder]
    pool = avail or real
    return min(pool, key=lambda o: o.price) if pool else None


def estimate(a: Album):
    """Valor de referencia por álbum: oferta de tienda disponible; si no, Discogs más barato."""
    o = best_offer(a)
    if o and (o.available or o.preorder):
        return o.price
    return a.discogs_lowest


def availability(a: Album) -> str:
    parts = []
    for o in a.offers:
        if o.store == "Fnac":
            parts.append("Fnac: buscar a mano")
        elif o.preorder:
            parts.append(f"{o.store}: preventa" + (f" ({o.release_date})" if o.release_date else ""))
        elif o.available:
            parts.append(f"{o.store}: en stock")
        elif o.available is False:
            parts.append(f"{o.store}: agotado")
    if a.discogs_for_sale:
        parts.append(f"Discogs: {a.discogs_for_sale} copias")
    counted = {}
    for x in parts:
        counted[x] = counted.get(x, 0) + 1
    parts = [x if n == 1 else x.replace(": ", f": {n} ediciones, ", 1) for x, n in counted.items()]
    return "; ".join(parts) or "sin datos"


def write_all(albums: list[Album], out: Path, meta: dict) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    cur = meta.get("currency", "EUR")
    total = sum(v for v in (estimate(a) for a in albums if not a.owned) if v)
    files = []

    f = out / "albumes.csv"
    with f.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["#", "artista", "album", "reproducciones", "minutos", "ultima_vez", "ya_lo_tengo",
                    f"discogs_mas_barato_{cur}", "discogs_copias", "discogs_vg+", "discogs_nm",
                    "discogs_have", "discogs_want", "mejor_tienda", f"precio_tienda_{cur}",
                    "disponibilidad", "discogs_url", "tienda_url"])
        for i, a in enumerate(albums, 1):
            b = best_offer(a)
            w.writerow([i, a.artist, a.album, a.plays, a.minutes, a.last_played[:10], "sí" if a.owned else "",
                        a.discogs_lowest, a.discogs_for_sale, a.discogs_vgplus, a.discogs_nm,
                        a.discogs_have, a.discogs_want, b.store if b else "", b.price if b else "",
                        availability(a), a.discogs_url, b.url if b else ""])
    files.append(f)

    f = out / "informe.md"
    L = ["# Tus álbumes más escuchados y cuánto valen en vinilo", "",
         f"- Periodo: {meta.get('periodo', '—')} · Fuentes: {', '.join(meta.get('fuentes', []))}",
         f"- Coste de comprar en vinilo los que **aún no tienes**: **{_price(total, cur)}** "
         "(oferta de tienda disponible o, si no, la copia más barata de Discogs)", ""]
    if meta.get("coleccion"):
        v = meta["coleccion"]
        L += [f"- Tu colección en Discogs: {v['count']} discos"
              + (f", valor mediano {v['value'].get('median')}" if v.get("value") else ""), ""]
    L += ["| # | Artista | Álbum | Plays | Min | Discogs desde | Mejor tienda | Disponibilidad |",
          "|--:|---|---|--:|--:|--:|---|---|"]
    for i, a in enumerate(albums, 1):
        b = best_offer(a)
        shop = f"[{b.store} {_price(b.price, cur)}]({b.url})" if b else "—"
        d = f"[{_price(a.discogs_lowest, cur)}]({a.discogs_url})" if a.discogs_url else "—"
        own = " ✅" if a.owned else ""
        L.append(f"| {i} | {a.artist} | {a.album}{own} | {a.plays} | {a.minutes:.0f} | {d} | {shop} | {availability(a)} |")
    L += ["", "> Precios orientativos y a fecha de generación. ✅ = ya está en tu colección de Discogs."]
    f.write_text("\n".join(L), encoding="utf-8")
    files.append(f)

    f = out / "informe.html"
    rows = ""
    for i, a in enumerate(albums, 1):
        b = best_offer(a)
        shop = f'<a href="{html.escape(b.url)}">{html.escape(b.store)} {_price(b.price, cur)}</a>' if b else "—"
        d = f'<a href="{html.escape(a.discogs_url)}">{_price(a.discogs_lowest, cur)}</a>' if a.discogs_url else "—"
        rows += (f"<tr><td>{i}</td><td>{html.escape(a.artist)}</td><td>{html.escape(a.album)}{' ✅' if a.owned else ''}</td>"
                 f"<td>{a.plays}</td><td>{a.minutes:.0f}</td><td>{d}</td><td>{shop}</td>"
                 f"<td>{html.escape(availability(a))}</td></tr>")
    f.write_text(f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Vinyl tracker</title><style>body{{font:15px system-ui;margin:1rem;max-width:1100px}}
table{{border-collapse:collapse;width:100%}}td,th{{padding:6px 8px;border-bottom:1px solid #8884;text-align:left}}
.wrap{{overflow-x:auto}}</style><h1>Álbumes más escuchados y su precio en vinilo</h1>
<p>Coste de comprar los que aún no tienes: <b>{_price(total, cur)}</b></p>
<div class="wrap"><table><tr><th>#<th>Artista<th>Álbum<th>Plays<th>Min<th>Discogs desde<th>Mejor tienda<th>Disponibilidad</tr>{rows}</table></div>""",
                 encoding="utf-8")
    files.append(f)
    return files
