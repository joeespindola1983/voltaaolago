// Service Worker para habilitar modo PWA Fullscreen no Android
const CACHE_NAME = 'vtl-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Apenas repassa a requisição, mas o Chrome exige este handler
  event.respondWith(fetch(event.request));
});
