/* Service Worker — CRM «Атланта» PWA */
const CACHE_NAME = 'atlanta-crm-v2';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/js/api.js',
  '/js/components/escape.js',
  '/js/app.js',
  '/js/components/toast.js',
  '/js/components/modal.js',
  '/js/components/table.js',
  '/js/components/charts.js',
  '/js/components/confirm-dialog.js',
  '/js/pages/login.js',
  '/js/pages/dashboard.js',
  '/js/pages/orders.js',
  '/js/pages/proposals.js',
  '/js/pages/clients.js',
  '/js/pages/client-profile.js',
  '/js/pages/components-catalog.js',
  '/js/pages/calculator.js',
  '/js/pages/equipment.js',
  '/js/pages/reports.js',
  '/js/pages/settings.js',
  '/icons/icon.svg',
  '/offline.html',
];

// Install — кэшируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
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
    }).then(() => self.clients.claim())
  );
});

// Fetch — стратегия
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API — только сеть. Ответы с персональными данными не кэшируем,
  // чтобы на общем компьютере они не были доступны после выхода.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ error: 'Нет соединения с сервером' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Загруженные файлы (/uploads) тоже не кэшируем: доступ к ним проверяется на сервере
  if (url.pathname.startsWith('/uploads/')) {
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
