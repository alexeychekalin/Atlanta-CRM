/* Service Worker — CRM «Атланта» PWA */
const CACHE_NAME = 'atlanta-crm-v1';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/js/api.js',
  '/js/app.js',
  '/js/components/toast.js',
  '/js/components/modal.js',
  '/js/components/table.js',
  '/js/components/charts.js',
  '/js/pages/login.js',
  '/js/pages/dashboard.js',
  '/js/pages/orders.js',
  '/js/pages/clients.js',
  '/js/pages/client-profile.js',
  '/js/pages/products.js',
  '/js/pages/components-catalog.js',
  '/js/pages/calculator.js',
  '/js/pages/reports.js',
  '/js/pages/settings.js',
  '/icons/icon.svg',
  '/offline.html',
];

// Install — кэшируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — удаляем старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — стратегия
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API-запросы — network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Кэшируем GET-запросы к API
          if (request.method === 'GET' && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  // Статика — cache first, fallback to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Обновляем кэш в фоне
        fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
          }
        }).catch(() => {});
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Оффлайн fallback для навигации
        if (request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      });
    })
  );
});
