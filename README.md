# VinylTracker

PWA para iPhone que cruza **lo que más escuchas en Spotify** con **tu colección de vinilos** y te dice
cuáles te faltan, **cuánto cuestan** y **dónde hay stock** (o preventa).

**App:** https://ruzzz05.github.io/VinylTracker/

![Logo](icons/logo-1024.png)

## Qué hace
- **Ranking** con cuatro vistas: **Álbumes**, **Artistas**, **Canciones** y **Estadísticas**, para 1 mes, 6 meses, 1 año o todo el historial. Con el export de Spotify salen minutos reales; con solo la API, un ranking aproximado.
- **Olvidados** (en Ranking): artistas y canciones que escuchaste mucho y llevan 3 meses, 6, 1 o 2 años sin sonar, con la fecha de la última vez y su pico. Pulsa **No** para excluir un artista (se guarda, también en la nube). Puedes elegir **playlists** tuyas como fuente (la fecha en que añadiste cada canción cuenta como última escucha: sirve para una playlist con casi todo lo que has escuchado, en orden) y **crear una playlist** de Spotify con lo que ves. Hace falta volver a conectar Spotify una vez para dar el permiso de playlists.
- **Estadísticas** (pestaña propia, con el historial importado): una sola página con el periodo (1 mes, 6 meses, 1 año o todo), el **tiempo escuchado** (minutos y horas, con la comparación con el periodo anterior), reproducciones, media al día, artistas distintos y % en vinilo, una **gráfica** (por día o por mes) y tus **tops** de artistas, canciones y álbumes, cada uno con «Ver todo». Ajustes está en el icono de la cabecera.
- **Colección**: tu lista de [mi-app](https://github.com/ruzzz05/mi-app) (CSV público + discos añadidos desde la app, leídos de Firestore con tu cuenta).
  - **Añadir disco** (también desde la propia colección): con enlace de Spotify (con Spotify conectado coge nombre, artista, año, sello, portada grande y los estilos del artista), **escaneando el código de barras** (Discogs: nombre, artista, año, portada y estilos) o **a mano**. Siempre sale un formulario para revisar y editar etiquetas, año y portada antes de guardar. Con enlace de Spotify + portada https y sesión de dueño se guarda en mi-app; si no, en una lista propia de VinylTracker (dispositivo + copia en la nube) que también cuenta como colección y se puede editar o quitar.
- **Comprar**, con tres vistas:
  - **Sugeridos**: lo que escuchas y aún no tienes, con el precio de tienda, stock o preventa. Al tocar un disco, su ficha con Discogs y los enlaces. Lo que marcas como comprado deja de salir.
  - **Deseos**: vinilos que quieres, como **álbum en cualquier edición** o como **edición concreta de Discogs**. Se añaden desde la ficha de un disco, buscando en Discogs, a mano o **escaneando el código de barras** (cámara; si el navegador no tiene lector propio se usa ZXing, y también puedes teclear el código). La app te **avisa** cuando aparece en stock o preventa en las tiendas (Discogs no cuenta para los avisos; aviso dentro de la app y, si los activas, notificaciones del sistema).
  - **Comprados**: lo que ya has comprado, con fecha y precio opcional, **sin añadirlo a la colección**.
- **Conciertos**: próximas fechas de tus 50 artistas más escuchados, por orden y agrupadas por mes, con filtro de país (España por defecto). Un GitHub Action descarga cada día los conciertos de música de Ticketmaster y los publica con la web; la app los cruza en el móvil con tus artistas. Sin claves en el móvil (ver «Conciertos» más abajo).
- **Portadas** en canciones, álbumes y singles (aunque no pertenezcan a ningún álbum): la del álbum si ya se conoce y, si no, Spotify (si está conectado) o iTunes Search. Las imágenes se guardan en el móvil (hasta 600): al cambiar de pestaña o reabrir la app no se vuelven a descargar.
- Ficha por álbum con enlaces a Discogs, tiendas, Fnac y El Corte Inglés (búsqueda) y Spotify.
- **Fotos de artista** en la lista de Artistas: de Spotify si está conectado y, si no, de Discogs (con tu token). Se guardan en el móvil, así que cada artista se consulta una sola vez.
- **En vivo** (con Spotify conectado): una tarjeta **«Suena ahora»** (con aviso de si ya lo tienes en vinilo) y un registro propio que se actualiza solo cada minuto y al volver a la app, y que se suma a Ranking y Estadísticas. Límites: Spotify solo recuerda tus últimas 50 canciones y la app solo puede consultarlas mientras está abierta, así que ábrela de vez en cuando; la duración de cada canción se toma completa (aproximada). Al importar un historial, lo que ya cubre deja de contarse dos veces.

## Diseño
Estilo **Tinta**: oscuro por defecto (también claro y automático en Ajustes), cristal, un **menú de iconos** (solo la pestaña activa enseña su nombre) y **color de ambiente**: cada pantalla toma el color dominante de la portada que la protagoniza (`js/tint.js`). Movimiento sobrio y que responde a lo que haces: la pantalla se funde al cambiar de pestaña, las filas y las barras entran escalonadas, las fichas suben y bajan, las cifras de Estadísticas cuentan hasta su valor y «Suena ahora» lleva un igualador. Todo se apaga con «reducir movimiento» del sistema.

## Instalar en el iPhone
1. Abre la URL en **Safari**.
2. Compartir → **Añadir a pantalla de inicio**.
3. Abre VinylTracker desde el icono. Funciona sin conexión con los últimos datos.

## Primer uso (en Ajustes)
| Qué | Cómo |
|---|---|
| **Cuenta de mi-app** | Usuario y contraseña de tu app Vinilos. La contraseña no se guarda. |
| **Spotify (API)** | Crea una app en <https://developer.spotify.com/dashboard>, añade el redirect URI que muestra Ajustes (`https://ruzzz05.github.io/VinylTracker/`), pon su *Client ID* y pulsa **Conectar Spotify**. Login PKCE, sin secreto. |
| **Historial de Spotify** | spotify.com/account/privacy. Sirven dos paquetes y puedes pedir los dos: **Datos de la cuenta** (llega antes; último año; sin álbumes: da artistas, canciones y estadísticas) y **Historial de reproducciones ampliado** (todo el histórico y los álbumes; puede tardar hasta 30 días). Importa el `.zip` tal cual. Se procesa en el móvil. |
| **Discogs** | <https://www.discogs.com/settings/developers> → *Generate new token*. Con token: más rápido; **imprescindible para buscar en Discogs** (deseos y código de barras). |

## Privacidad
- La lista de deseos y comprados, los tokens, el historial y los precios se guardan **solo en tu dispositivo** (IndexedDB / localStorage). No hay servidor propio.
- Este repo es público y **no contiene datos personales ni secretos**. La configuración de Firebase y el Client ID de Spotify son públicos por diseño (ver `js/config.js`); la protección real son las reglas de Firestore.

## Cómo funciona
```
index.html, css/, js/        PWA sin build (módulos ES): ranking, colección, precios
js/core.js · js/stats.js     Lógica pura (emparejar álbumes, ranking, ofertas, estadísticas) · tests en tests/
js/wishlist.js · wishview.js Deseos y comprados (lógica pura de avisos + pantallas); barcode.js lee códigos de barras (js/vendor/zxing.min.js)
js/concerts.js · concertsview.js  Conciertos (data/concerts.json); js/covers.js · imgcache.js portadas y caché de imágenes; js/cloud.js copia en Firestore
cli/vinyl_tracker/concerts.py   Descarga de Ticketmaster (en CI)
js/charts.js · statsview.js  Gráficos HTML/CSS (columnas, barras, mapa de calor) y pantallas de estadísticas
js/spotify.js · discogs.js   APIs que permiten CORS: se llaman desde el navegador
js/firebase.js               Login y lectura de Firestore por REST (sin SDK)
js/zip.js                    Lee el .zip de Spotify en el móvil
sw.js · manifest             Instalable y offline
tools/build_site.py          Descarga los catálogos de las tiendas → data/stores.json
.github/workflows/pages.yml  Publica en Pages a diario
cli/                         Versión de línea de comandos en Python (opcional)
```
**Tiendas**: Universal Music Online, Apparell, Sony Music Store y varias tiendas españolas pequeñas (las que no sean Shopify se saltan solas; el log del despliegue dice cuáles entran) (Shopify; para añadir otra basta una línea en `SHOPIFY_STORES`, de `cli/vinyl_tracker/stores.py`). No permiten CORS, así que un GitHub Action descarga
sus catálogos de vinilos cada día y los publica junto a la web (`data/stores.json`).
**Fnac** y **El Corte Inglés** bloquean las consultas automáticas: se ofrece un enlace de búsqueda.

## Conciertos (una sola vez)
1. Crea una cuenta en <https://developer.ticketmaster.com> y copia la *Consumer Key* de tu app (gratis).
2. En el repo: **Settings → Secrets and variables → Actions → New repository secret**, nombre `TICKETMASTER_KEY`, valor la clave.
3. Lanza el workflow (**Actions → Publicar en GitHub Pages → Run workflow**) o espera al de la noche. Países por defecto: ES, PT, FR, DE, GB, IT (cámbialos con la variable `CONCERT_COUNTRIES` en `pages.yml`).
Sin el secreto, el sitio se publica igual y la pestaña Conciertos avisa de que faltan datos.

## Publicar en GitHub Pages
1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. Haz push a `main`: el workflow monta y publica el sitio. También se ejecuta cada día a las 05:23 UTC.

## Desarrollo
```bash
node --test tests/*.test.mjs                       # lógica
python tools/build_site.py && python -m http.server -d _site   # sitio local
NODE_PATH=$(npm root -g) node tests/e2e/smoke.mjs  # flujo completo en iPhone virtual (Playwright)
NODE_PATH=$(npm root -g) node tests/e2e/sheets.mjs  # fichas y paneles: siempre se pueden cerrar (iPhone 14 y SE)
NODE_PATH=$(npm root -g) node tools/make_icons.js  # regenera los iconos desde icons/logo.svg
```
No hay dependencias que instalar para usar la app.

## Licencia
MIT.
