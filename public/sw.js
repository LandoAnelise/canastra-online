// Service Worker — sempre busca da rede, sem cache local.
// Garante que o PWA no Android sempre recebe a versão mais recente do servidor.

const VERSION = '1';

self.addEventListener('install', () => {
  // Ativa imediatamente sem esperar a aba ser fechada
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Assume controle de todas as abas abertas imediatamente
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  // Passa tudo direto para a rede; se falhar (offline), tenta cache do browser
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
