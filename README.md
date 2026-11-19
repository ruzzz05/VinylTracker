# VinylTracker

PWA para iPhone que cruza **lo que más escuchas en Spotify** con **tu colección de vinilos** y te dice
cuáles te faltan, **cuánto cuestan** y **dónde hay stock** (o preventa).

**App:** https://ruzzz05.github.io/VinylTracker/

![Logo](icons/logo-1024.png)

## Qué hace
- **Ranking**: tus álbumes más escuchados (1 mes, 6 meses, 1 año o todo) con minutos reales si importas el export de Spotify, o aproximado con la API.
- **Colección**: tu lista de [mi-app](https://github.com/ruzzz05/mi-app) (CSV público + discos añadidos desde la app, leídos de Firestore con tu cuenta).
- **Comprar**: lo que escuchas y aún no tienes, con precio de tienda o de Discogs, stock/preventa y el coste total.
- Ficha por álbum con enlaces a Discogs, tiendas, Fnac (búsqueda) y Spotify.

## Instalar en el iPhone
1. Abre la URL en **Safari**.
2. Compartir → **Añadir a pantalla de inicio**.
3. Abre VinylTracker desde el icono. Funciona sin conexión con los últimos datos.

## Primer uso (en Ajustes)
| Qué | Cómo |
|---|---|
| **Cuenta de mi-app** | Usuario y contraseña de tu app Vinilos. La contraseña no se guarda. |
| **Spotify (API)** | Crea una app en <https://developer.spotify.com/dashboard>, añade el redirect URI que muestra Ajustes (`https://ruzzz05.github.io/VinylTracker/`), pon su *Client ID* y pulsa **Conectar Spotify**. Login PKCE, sin secreto. |
| **Historial de Spotify** | spotify.com/account/privacy → *Historial de reproducciones ampliado*. Importa el `.zip` tal cual. Se procesa en el móvil. |
| **Discogs** | <https://www.discogs.com/settings/developers> → *Generate new token*. Con token: más rápido y valor de tu colección. |

## Privacidad
- Los tokens, el historial y los precios se guardan **solo en tu dispositivo** (IndexedDB / localStorage). No hay servidor propio.
- Este repo es público y **no contiene datos personales ni secretos**. La configuración de Firebase y el Client ID de Spotify son públicos por diseño (ver `js/config.js`); la protección real son las reglas de Firestore.

## Cómo funciona
```
index.html, css/, js/        PWA sin build (módulos ES): ranking, colección, precios
js/core.js                   Lógica pura (emparejar álbumes, ranking, ofertas) · tests en tests/
js/spotify.js · discogs.js   APIs que permiten CORS: se llaman desde el navegador
js/firebase.js               Login y lectura de Firestore por REST (sin SDK)
js/zip.js                    Lee el .zip de Spotify en el móvil
sw.js · manifest             Instalable y offline
tools/build_site.py          Descarga los catálogos de las tiendas → data/stores.json
.github/workflows/pages.yml  Publica en Pages a diario
cli/                         Versión de línea de comandos en Python (opcional)
```
**Tiendas**: Universal Music Online y Apparell (Shopify). No permiten CORS, así que un GitHub Action descarga
sus catálogos de vinilos cada día y los publica junto a la web (`data/stores.json`).
**Fnac** bloquea las consultas automáticas: se ofrece un enlace de búsqueda.

## Publicar en GitHub Pages
1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. Haz push a `main`: el workflow monta y publica el sitio. También se ejecuta cada día a las 05:23 UTC.

## Desarrollo
```bash
node --test tests/*.test.mjs                       # lógica
python tools/build_site.py && python -m http.server -d _site   # sitio local
NODE_PATH=$(npm root -g) node tests/e2e/smoke.mjs  # flujo completo en iPhone virtual (Playwright)
NODE_PATH=$(npm root -g) node tools/make_icons.js  # regenera los iconos desde icons/logo.svg
```
No hay dependencias que instalar para usar la app.

## Licencia
MIT.
