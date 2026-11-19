"""Normalización de textos para emparejar álbumes entre servicios."""
import re
import unicodedata

STOP = {
    "the", "a", "an", "el", "la", "los", "las", "de", "del", "and", "y", "of",
    "vinilo", "vinyl", "lp", "cd", "2lp", "remastered", "remaster", "deluxe",
    "edition", "edicion", "version", "anniversary", "expanded", "reissue",
}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return s.replace("&", " and ")


def clean_album(name: str) -> str:
    """Quita sufijos tipo '(Deluxe)', '[Remastered]' o '- 2011 Remaster'."""
    name = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", name or "")
    name = re.sub(r"\s-\s.*(remaster|deluxe|edition|version|anniversary).*$", " ", name, flags=re.I)
    return name.strip()


def tokens(s: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", fold(s)) if t not in STOP]


def album_key(artist: str, album: str) -> str:
    return " ".join(tokens(artist)) + "|" + " ".join(tokens(clean_album(album)))


def overlap(needle: list[str], haystack: set[str]) -> float:
    if not needle:
        return 0.0
    return sum(1 for t in needle if t in haystack) / len(needle)
