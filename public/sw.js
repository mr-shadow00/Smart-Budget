// public/sw.js
// Intentionally does no caching — this app's whole point is live data from
// your own server, so a stale cache would do more harm than good. This file
// exists only so browsers recognize the app as installable on more devices.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass every request straight through to the network.
  event.respondWith(fetch(event.request));
});
