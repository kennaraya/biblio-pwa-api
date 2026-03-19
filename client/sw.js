/* Service Worker — Biblioteca PWA + API */

const CACHE_VERSION = "v1";                          // Versión del caché: incrementar al actualizar archivos clave
const CACHE_NAME    = `biblio-pwa-api-${CACHE_VERSION}`; // Nombre único del caché activo

// App Shell: archivos mínimos para que la app cargue sin red
// Si falta uno solo, el install falla y el SW no se activa
const APP_SHELL = [
  "/",                        // Página principal (index.html servido por Express)
  "/index.html",              // Copia directa del HTML
  "/styles.css",              // Estilos
  "/app.js",                  // Lógica del cliente
  "/manifest.webmanifest",    // Manifest PWA (necesario para instalación)
  "/offline.html",            // Fallback cuando no hay red ni caché
  "/icons/icon-192.png",      // Icono pequeño
  "/icons/icon-512.png"       // Icono grande
];

// Se dispara cuando el SW es descargado por primera vez (o cuando cambia el archivo sw.js)
self.addEventListener("install", (event) => {
  event.waitUntil(                            // Le dice al navegador que NO active el SW hasta que esto termine
    caches.open(CACHE_NAME)                   // Abre (o crea) el caché con nombre CACHE_NAME
      .then((cache) => cache.addAll(APP_SHELL)) // Descarga y cachea TODOS los archivos del App Shell
  );
  self.skipWaiting(); // Activa el nuevo SW inmediatamente (sin esperar a que se cierre la pestaña)
});

// Se dispara cuando el SW nuevo toma el control (después de install)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>          // Obtiene los nombres de todos los caches existentes
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME) // Filtra: conserva solo el caché actual
          .map((k) => caches.delete(k))    // Elimina todos los caches de versiones anteriores
      )
    )
  );
  self.clients.claim(); // Toma el control de las pestañas abiertas inmediatamente (sin esperar recarga)
});

// Estrategia: Caché primero (para archivos estáticos)
async function cacheFirst(req) {
  const cached = await caches.match(req); // Busca en todos los caches abiertos
  if (cached) return cached;              // Si lo tiene → devuelve la copia cacheada (instantáneo)
  const fresh  = await fetch(req);        // Si no → va a la red
  const cache  = await caches.open(CACHE_NAME);
  cache.put(req, fresh.clone());          // Guarda una copia en caché para futuras visitas
  return fresh;                           // Devuelve la respuesta fresca
}

// Estrategia: Red primero con fallback a caché
// cacheIt = false para endpoints privados (reservas): evita almacenar datos de un usuario
async function networkFirst(req, { cacheIt = true } = {}) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);              // Intenta obtener respuesta fresca de la red
    if (cacheIt) cache.put(req, fresh.clone()); // Solo cachea si está permitido
    return fresh;
  } catch {
    // Sin red: busca en caché
    const cached = await caches.match(req);
    if (cached) return cached;                   // Sirve la copia cacheada si existe

    // Para navegaciones (HTML), sirve la página offline como fallback
    if (req.mode === "navigate") return caches.match("/offline.html");

    // Para otros recursos sin caché, devuelve error 503
    return new Response("Sin conexión y recurso no disponible en caché.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo intercepta peticiones GET (POST/DELETE de reservas pasan directo a red)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo intercepta peticiones al mismo origen (no CDNs ni APIs externas)
  if (url.origin !== self.location.origin) return;

  // ── Regla 1: Navegaciones (cargar páginas HTML) ──
  // Network First: intenta HTML fresco; si no hay red, sirve offline.html
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // ── Regla 2: API catálogo (PÚBLICA) ──
  // Network First + se cachea: permite ver libros aunque haya pérdida de cobertura
  if (url.pathname.startsWith("/api/books")) {
    event.respondWith(networkFirst(req, { cacheIt: true }));
    return;
  }

  // ── Regla 3: API reservas (PRIVADA) ──
  // Network First + NO se cachea: evitar mezclar reservas entre usuarios del mismo dispositivo
  if (url.pathname.startsWith("/api/reservations")) {
    event.respondWith(networkFirst(req, { cacheIt: false }));
    return;
  }

  // ── Regla 4: Archivos estáticos (CSS, JS, iconos, etc.) ──
  // Cache First: estos archivos no cambian frecuentemente; sirve desde caché para máxima velocidad
  event.respondWith(cacheFirst(req));
});