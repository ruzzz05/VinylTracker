# vinyl-tracker

Toma tus álbumes más escuchados en Spotify y calcula cuánto cuestan en vinilo,
dónde hay stock, si están en preventa y cuántas copias hay en Discogs.

Solo usa la librería estándar de Python 3.10+. Sin dependencias.

## Fuentes
| Fuente | Qué aporta | Notas |
|---|---|---|
| Export de Spotify (`Streaming_History_Audio_*.json`) | minutos y reproducciones reales por álbum | Spotify → Privacidad → "Descargar tus datos" → *Extended streaming history*. Admite carpeta o `.zip`. |
| API de Spotify | top tracks (corto/medio/largo plazo), recientes, álbumes guardados | Login PKCE, sin client secret. |
| Discogs | precio más barato en vinilo, copias a la venta, have/want, tu colección | Con `DISCOGS_TOKEN` el límite es 60 req/min. |
| universalmusiconline.es, apparell.com | precio, stock, preventa, fecha | Catálogo público Shopify (`products.json`). |
| Fnac | solo enlace de búsqueda | Bloquea consultas automáticas (403). No se intenta saltar. |

## Uso
```bash
cp .env.example .env        # rellena DISCOGS_TOKEN, DISCOGS_USERNAME, SPOTIFY_CLIENT_ID

# Solo con el export de Spotify
python -m vinyl_tracker analyze --history ~/Descargas/my_spotify_data.zip --days 365 --top 30

# Combinando export + API
python -m vinyl_tracker auth-spotify   # una vez; redirect URI: http://127.0.0.1:8888/callback
python -m vinyl_tracker analyze --history ~/Descargas/my_spotify_data.zip --api
```
Salida en `out/`: `informe.md`, `informe.html`, `albumes.csv`.

Opciones: `--days 0` (todo el historial), `--currency EUR`, `--no-stores`, `--no-fnac`.

## Cómo se calcula el valor
Para cada álbum que **aún no tienes** (según tu colección de Discogs):
oferta de tienda disponible o en preventa más barata; si no hay, la copia más barata de Discogs.
El total es el coste de comprar tu top en vinilo. Son precios orientativos del momento de la consulta.

## Spotify
1. Crea una app en <https://developer.spotify.com/dashboard>.
2. Añade el redirect URI `http://127.0.0.1:8888/callback`.
3. Pon el *Client ID* en `.env`. El login abre el navegador, así que ejecútalo en tu máquina.

La API no da minutos reales ni historial completo (por eso conviene combinarla con el export).
Los tokens se guardan en `~/.config/vinyl-tracker/spotify.json` (permisos 600).

## Privacidad
`.env`, `.cache/`, `out/` y los exports (`data/`, `*.zip`) están en `.gitignore`.

## Tests
```bash
python -m unittest discover -s tests -t .
```
