from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Album:
    artist: str
    album: str
    plays: int = 0               # reproducciones (>=30 s) en el periodo
    minutes: float = 0.0
    tracks: int = 0              # canciones distintas escuchadas
    last_played: str = ""
    sources: set = field(default_factory=set)   # {"historial", "api", "guardado"}
    # Discogs
    discogs_id: Optional[int] = None
    discogs_url: str = ""
    discogs_lowest: Optional[float] = None
    discogs_for_sale: Optional[int] = None
    discogs_vgplus: Optional[float] = None
    discogs_nm: Optional[float] = None
    discogs_have: Optional[int] = None
    discogs_want: Optional[int] = None
    currency: str = "EUR"
    owned: bool = False
    # Tiendas: lista de StoreHit
    offers: list = field(default_factory=list)


@dataclass
class StoreHit:
    store: str
    title: str
    price: Optional[float]
    available: Optional[bool]
    preorder: bool
    url: str
    release_date: str = ""
    note: str = ""
