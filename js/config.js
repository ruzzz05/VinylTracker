// Configuración pública. Nada de esto es secreto:
// - Firebase: los datos de conexión van en cualquier web; la protección real son las reglas de Firestore.
// - El Client ID de Spotify es público por diseño (flujo PKCE, sin client secret).
// Los tokens (Discogs, Spotify) los introduces tú y se guardan solo en tu dispositivo.
export const config = {
  firebase: {
    apiKey: 'AIzaSyCnFhLS9YxR1MnSDwwrKteWaW0CpMuqgdM',
    projectId: 'mi-app-490b5'
  },
  authEmailDomain: '@mi-app.invalid',
  miApp: {
    base: 'https://ruzzz05.github.io/mi-app/',
    csv: 'apps/vinilos/musica.csv',
    images: 'apps/vinilos/'
  },
  firestoreDoc: 'vinilos/coleccion',
  spotifyClientId: 'd48de50d984d42b78cb04ad64dea071c',
  spotifyScopes: 'user-top-read user-read-recently-played user-library-read',
  currency: 'EUR'
};
