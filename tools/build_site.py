#!/usr/bin/env python3
"""Monta `_site/` (la PWA + data/stores.json con los vinilos de las tiendas).

Las tiendas Shopify no permiten CORS, así que un navegador no puede consultarlas.
Este script lo hace en el servidor (GitHub Actions, a diario) y publica un JSON compacto.
Solo librería estándar. Uso: python tools/build_site.py [--out _site] [--skip-stores]
"""
import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "cli"))

from vinyl_tracker import concerts as CONC  # noqa: E402
from vinyl_tracker import stores as S  # noqa: E402
from vinyl_tracker.http import HttpError  # noqa: E402

PWA_FILES = ["index.html", "manifest.webmanifest", "sw.js", "favicon.svg"]
PWA_DIRS = ["css", "js", "icons"]


def is_vinyl(p: dict) -> bool:
    text = " ".join([p.get("title", ""), p.get("handle", ""), p.get("product_type", ""), " ".join(p.get("tags", []))])
    return bool(S.VINYL.search(text))


def compact(products: list[dict]) -> list[list]:
    items = []
    for p in products:
        if not is_vinyl(p):
            continue
        variants = p.get("variants", [])
        prices = [float(v["price"]) for v in variants if v.get("price")]
        if not prices:
            continue
        pre = bool(S.PREORDER.search(" ".join(p.get("tags", [])) + " " + p.get("title", "")))
        items.append([
            p["title"], p.get("vendor", ""), min(prices),
            1 if any(v.get("available") for v in variants) else 0,
            p["handle"], 1 if pre else 0, S._extract_date(p.get("body_html", "")),
        ])
    return items


def build_stores() -> dict:
    out = {}
    for name, base in S.SHOPIFY_STORES.items():
        try:
            items = compact(S.fetch_catalog(base))
            out[name] = {"base": base, "items": items}
            print(f"  {name}: {len(items)} vinilos")
            if not items:
                print(f"  ! {name}: sin vinilos (¿no es Shopify?), se ignora", file=sys.stderr)
                del out[name]
        except (HttpError, OSError, ValueError, KeyError) as e:      # ValueError: la web no devolvió JSON (no es Shopify)
            print(f"  ! {name}: {e}", file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site")
    ap.add_argument("--skip-stores", action="store_true")
    args = ap.parse_args()
    out = ROOT / args.out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in PWA_FILES:
        shutil.copy2(ROOT / f, out / f)
    for d in PWA_DIRS:
        shutil.copytree(ROOT / d, out / d)
    (out / "data").mkdir()
    data = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "stores": {}}
    if not args.skip_stores:
        data["stores"] = build_stores()
        if not data["stores"]:
            sys.exit("No se pudo descargar ninguna tienda")
    key = os.environ.get("TICKETMASTER_KEY", "").strip()
    if key and not args.skip_stores:
        print("Conciertos (Ticketmaster):")
        countries = [c.strip().upper() for c in os.environ.get("CONCERT_COUNTRIES", "ES,PT,FR,DE,GB,IT").split(",") if c.strip()]
        conc = CONC.build(key, countries)
        if conc["countries"]:
            (out / "data" / "concerts.json").write_text(json.dumps(conc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    else:
        print("Conciertos: sin TICKETMASTER_KEY, se omiten")
    (out / "data" / "stores.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    print(f"Sitio listo en {out}")


if __name__ == "__main__":
    main()
