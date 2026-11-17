// Importar el mini-wrapper de IndexedDB en el contexto del Service Worker (Tema 5.3 - Fragmento A)
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json'
];

// 1. EVENTO INSTALL: Precarga del App Shell (Tema 3.3)
self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_FILES);
      })
  );
});

// 2. EVENTO ACTIVATE: Limpieza de cachés obsoletas y toma de control (Tema 3.3 y Tema 4.2)
self.addEventListener('activate', (event) => {
  const listaBlanca = [CACHE_STATIC_NAME];

  event.waitUntil(
    caches.keys()
      .then((nombresCaches) => {
        return Promise.all(
          nombresCaches.map((nombreCache) => {
            if (!listaBlanca.includes(nombreCache)) {
              console.log('[SW] Purgando contenedor obsoleto:', nombreCache);
              return caches.delete(nombreCache);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. EVENTO FETCH: Servir App Shell para peticiones GET (Tema 3.3 y Tema 4.2)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

// Notificación del Worker hacia las Pestañas Abiertas (Tema 5.3 - Fragmento B)
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

// Motor de Sincronización en Segundo Plano (Tema 5.3 - Fragmento C)
function sincronizarPendientesSW() {
  console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then((respuesta) => {
            if (!respuesta.ok) {
              throw new Error(`Error HTTP ${respuesta.status} al sincronizar ID ${item.id}`);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(() => notificarClientesActualizacion());
    });
}

// Escucha del Evento sync en sw.js (Tema 5.3 - Fragmento D)
self.addEventListener('sync', (event) => {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW()
        .catch((error) => {
          console.error('[SW-Sync] Falla en sincronización; el navegador reintentará luego:', error);
          // Relanzar el error indica al navegador que debe programar un reintento automático
          throw error;
        })
    );
  }
});