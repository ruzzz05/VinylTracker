import argparse
import os
import sys
from pathlib import Path

from . import discogs, report, spotify_api, spotify_history, stores


def load_env(path=".env"):
    p = Path(path)
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if v.strip():
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))


def rank(albums: dict, top: int):
    return sorted(albums.values(), key=lambda a: (a.minutes, a.plays), reverse=True)[:top]


def analyze(args):
    albums, fuentes, meta = {}, [], {"currency": args.currency}
    if args.history:
        albums, s = spotify_history.load_history(args.history, None if args.days == 0 else args.days)
        fuentes.append("historial Spotify")
        print(f"Historial: {s['entradas']} entradas, {s['reproducciones_contadas']} reproducciones, "
              f"{len(albums)} álbumes ({s['sin_album']} sin álbum omitidas)")
    if args.api:
        spotify_api.load_api_albums(albums)
        fuentes.append("API Spotify")
        print(f"Tras la API: {len(albums)} álbumes")
    if not albums:
        sys.exit("Sin datos: usa --history RUTA y/o --api")
    top = rank(albums, args.top)
    owned = set()
    if os.environ.get("DISCOGS_USERNAME") and os.environ.get("DISCOGS_TOKEN"):
        c = discogs.collection(os.environ["DISCOGS_USERNAME"], args.currency)
        owned, meta["coleccion"] = c["ids"], c
        print(f"Colección Discogs: {c['count']} discos")
    print(f"Consultando Discogs para {len(top)} álbumes…")
    for i, a in enumerate(top, 1):
        discogs.lookup(a, args.currency)
        a.owned = a.discogs_id in owned
        print(f"  [{i}/{len(top)}] {a.artist} - {a.album}: {a.discogs_lowest}")
    if not args.no_stores:
        print("Consultando tiendas…")
        stores.find_offers(top, use_fnac=not args.no_fnac)
    fuentes.append("Discogs")
    if not args.no_stores:
        fuentes.append("tiendas")
    meta.update(fuentes=fuentes, periodo="todo el historial" if args.days == 0 else f"últimos {args.days} días")
    for f in report.write_all(top, Path(args.out), meta):
        print("→", f)


def main(argv=None):
    load_env()
    ap = argparse.ArgumentParser(prog="vinyl_tracker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("auth-spotify", help="Login en Spotify (PKCE) y guarda el token")
    p = sub.add_parser("analyze", help="Ranking de álbumes + precios y disponibilidad")
    p.add_argument("--history", help="carpeta o .zip del export de Spotify")
    p.add_argument("--api", action="store_true", help="añade datos de la API de Spotify")
    p.add_argument("--days", type=int, default=365, help="ventana del historial (0 = todo)")
    p.add_argument("--top", type=int, default=30)
    p.add_argument("--currency", default="EUR")
    p.add_argument("--out", default="out")
    p.add_argument("--no-stores", action="store_true")
    p.add_argument("--no-fnac", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "auth-spotify":
        cid = os.environ.get("SPOTIFY_CLIENT_ID") or sys.exit("Define SPOTIFY_CLIENT_ID en .env")
        spotify_api.login(cid)
    else:
        analyze(args)
