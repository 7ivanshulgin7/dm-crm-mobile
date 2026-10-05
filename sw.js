// Service worker PWA DM_CRM Mobile.
// CACHE_NAME ставит build-pwa.js по версии из Code.gs — руками не менять.
// Новая версия = новое имя кэша: старый удаляется в activate.
const CACHE_NAME = 'dmcrm-mobile-v2.8';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Сначала сеть, при неудаче — кэш. Удачный ответ кладём в кэш.
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); }).catch(function (e) { console.error(e); });
    }
    return res;
  }).catch(function (err) {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (cached) {
      if (cached) return cached;
      throw err;
    });
  });
}

const NAV_TIMEOUT_MS = 3000;
function navigateWithTimeout(req) {
  const network = networkFirst(req);
  const timeout = new Promise(function (resolve) {
    setTimeout(function () {
      caches.match(req, { ignoreSearch: true }).then(function (cached) { if (cached) resolve(cached); });
    }, NAV_TIMEOUT_MS);
  });
  return Promise.race([network, timeout]);
}

// Сначала кэш (быстрый старт), в фоне обновляем.
function cacheFirst(req) {
  return caches.match(req).then(function (cached) {
    const network = fetch(req).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); }).catch(function (e) { console.error(e); });
      }
      return res;
    });
    if (cached) {
      network.catch(function (e) { console.error('SW background update:', e); });
      return cached;
    }
    return network;
  });
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const isOwnOrigin = req.url.indexOf(self.location.origin) === 0;

  if (!isOwnOrigin) {
    // Данные из Apps Script (?action=getBoard/getDealDetail): свежие из сети,
    // без связи — последний сохранённый ответ (доска откроется офлайн).
    event.respondWith(networkFirst(req));
  } else if (req.mode === 'navigate') {
    // Сама страница — из сети (новая версия видна сразу), но на медленной
    // сети не дольше NAV_TIMEOUT_MS: дальше — из кэша, сеть докэширует в фоне.
    event.respondWith(navigateWithTimeout(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});
