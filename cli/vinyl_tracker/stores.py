"""Tiendas: catálogo Shopify (products.json) y Fnac (best-effort, bloquea bots)."""
import html
import re
import urllib.parse

from .http import HttpError, cached_json, request
from .models import Album, StoreHit
from .text import clean_album, overlap, tokens

SHOPIFY_STORES = {
    "Universal Music Online": "https://universalmusiconline.es/collections/vinilos",
    "Apparell": "https://apparell.com",
    "Sony Music Store": "https://store.sonymusic.es/collections/vinilos",
    # Tiendas españolas de vinilo sin confirmar que sean Shopify: si no lo son, el despliegue las salta y avisa en el log.
    "Discos Marcapasos": "https://www.discosmarcapasos.com",
    "Discos EGA": "https://discosega.es",
    "Sweet Grooves Records": "https://sweetgroovesrecords.com",
    "Max Vinilos": "https://maxvinilos.com",
    "La Casa del Disco": "https://www.lacasadeldisco.es",
    "Discos Alta Fidelidad": "https://discosaltafidelidad.es",
}
# Para añadir otra tienda basta una línea más: sirve cualquier web hecha con Shopify (si tiene /products.json).
# Si una tienda no responde o no es Shopify, se salta sin romper nada (el log del despliegue dice cuál).
FNAC_SEARCH = "https://www.fnac.es/SearchResult/ResultList.aspx?Search="
MONTHS = {m: i for i, m in enumerate(
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(), 1)}
VINYL = re.compile(r"vinil|vinyl|\blp\b", re.I)
PREORDER = re.compile(r"preventa|pre-?order|reserva", re.I)


def fetch_catalog(base: str, max_pages: int = 40) -> list[dict]:
    """Descarga todo el catálogo público de una tienda Shopify, paginando."""
    out = []
    for page in range(1, max_pages + 1):
        d = cached_json(f"{base}/products.json", {"limit": 250, "page": page}, ttl=3600, pause=0.5)
        items = d.get("products", [])
        out += items
        if len(items) < 250:
            break
    return out


def _extract_date(body_html: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", body_html or ""))
    m = re.search(r"(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})", text, re.I)
    if m and m.group(2).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", text)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return ""


def index_catalog(products: list[dict]) -> list[tuple[set, dict]]:
    idx = []
    for p in products:
        text = " ".join([p.get("title", ""), p.get("vendor", ""), p.get("handle", "").replace("-", " "),
                         p.get("product_type", ""), " ".join(p.get("tags", []))])
        idx.append((set(tokens(text)), p))
    return idx


def match(album: Album, idx, store: str, base: str, min_album=0.99, min_artist=0.5) -> list[StoreHit]:
    a_t, b_t = tokens(album.artist), tokens(clean_album(album.album))
    hits = []
    for toks, p in idx:
        if not VINYL.search(" ".join([p.get("title", ""), p.get("handle", ""), p.get("product_type", ""),
                                      " ".join(p.get("tags", []))])):
            continue    # solo vinilos (descarta libros, CDs, camisetas…)
        if overlap(b_t, toks) < min_album or overlap(a_t, toks) < min_artist:
            continue
        variants = p.get("variants", [])
        prices = [float(v["price"]) for v in variants if v.get("price")]
        tags = " ".join(p.get("tags", []))
        pre = bool(PREORDER.search(tags + " " + p.get("title", "")))
        origin = urllib.parse.urlparse(base)
        hits.append(StoreHit(
            store=store, title=p["title"], price=min(prices) if prices else None,
            available=any(v.get("available") for v in variants) if variants else None,
            preorder=pre, url=f"{origin.scheme}://{origin.netloc}/products/{p['handle']}",
            release_date=_extract_date(p.get("body_html", "")),
            note=p.get("product_type", "")))
    return hits


def fnac_search_url(album: Album) -> str:
    return FNAC_SEARCH + urllib.parse.quote_plus(f"{album.artist} {clean_album(album.album)} vinilo")


def fnac_check(album: Album) -> StoreHit | None:
    """Fnac usa protección anti-bot (403 desde servidores). No se intenta saltarla:
    si responde 200 se parsea de forma básica; si no, se deja el enlace de búsqueda."""
    url = fnac_search_url(album)
    try:
        page = request(url, headers={"Accept": "text/html"}, retries=0)
    except HttpError as e:
        return StoreHit("Fnac", "(búsqueda manual)", None, None, False, url,
                        note=f"Fnac bloquea consultas automáticas (HTTP {e.status})")
    m = re.search(r'class="Article-price[^"]*"[^>]*>\s*([\d.,]+)', page)
    price = float(m.group(1).replace(".", "").replace(",", ".")) if m else None
    return StoreHit("Fnac", "(primer resultado de búsqueda)", price, None, False, url,
                    note="Precio aproximado: verifica en la web")


def find_offers(albums: list[Album], stores=None, use_fnac=True, progress=print) -> None:
    stores = stores or SHOPIFY_STORES
    catalogs = {}
    for name, base in stores.items():
        try:
            prods = fetch_catalog(base)
            catalogs[name] = (base, index_catalog(prods))
            progress(f"  {name}: {len(prods)} productos")
        except (HttpError, OSError) as e:
            progress(f"  ! {name} no disponible: {e}")
    for a in albums:
        for name, (base, idx) in catalogs.items():
            a.offers += match(a, idx, name, base)
        if use_fnac:
            h = fnac_check(a)
            if h:
                a.offers.append(h)
