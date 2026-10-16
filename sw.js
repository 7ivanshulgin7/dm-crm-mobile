// Service worker PWA DM_CRM Mobile.
// CACHE_NAME ставит build-pwa.js по версии из Code.gs — руками не менять.
// Новая версия = новое имя кэша: старый удаляется в activate.
const CACHE_NAME = 'dmcrm-mobile-v2.26';
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

// Скачать из сети и, если ответ удачный, положить в кэш. Промис ждёт и
// записи в кэш — его отдают в event.waitUntil, чтобы телефон не усыпил
// service worker, пока новая версия докачивается в фоне.
function fetchAndCache(req, fetchReq) {
  return fetch(fetchReq || req).then(function (res) {
    if (!res || !res.ok) return res;
    const copy = res.clone();
    return caches.open(CACHE_NAME)
      .then(function (c) { return c.put(req, copy); })
      .catch(function (e) { console.error('SW cache put:', e); })
      .then(function () { return res; });
  });
}

// Сначала сеть, при неудаче — кэш (данные Apps Script).
function networkFirst(req) {
  return fetchAndCache(req).catch(function (err) {
    return caches.match(req).then(function (cached) {
      if (cached) return cached;
      throw err;
    });
  });
}

// Сама страница (вся оболочка: html + css + js внутри index.html).
// Сеть ждём не дольше NAV_TIMEOUT_MS: успела — свежая версия, нет — из
// кэша, а сеть докачивает новую версию в фоне для следующего запуска.
// Без связи fetch падает сразу — тоже кэш. Кэша нет (первый запуск) — ждём сеть.
const NAV_TIMEOUT_MS = 1500;
function navigate(event) {
  const req = event.request;
  // no-cache: браузерный HTTP-кэш (GitHub Pages держит до 10 мин) не
  // подсовывает старую страницу — проверка у сервера по ETag, 304 быстро.
  const network = fetchAndCache(req, new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }));
  event.waitUntil(network.catch(function (e) { console.error('SW navigate (фон):', e); }));
  const cachedP = caches.match(req, { ignoreSearch: true });
  return new Promise(function (resolve, reject) {
    let done = false;
    function useCache(orElse) {
      cachedP.then(function (cached) {
        if (done) return;
        if (cached) { done = true; resolve(cached); } else if (orElse) orElse();
      });
    }
    const timer = setTimeout(function () { useCache(null); }, NAV_TIMEOUT_MS);
    network.then(function (res) {
      if (done) return;
      if (res && res.ok) { done = true; clearTimeout(timer); resolve(res); return; }
      useCache(function () { done = true; clearTimeout(timer); resolve(res); }); // 404/500: лучше кэш, если есть
    }, function (err) {
      if (done) return;
      clearTimeout(timer);
      useCache(function () { done = true; reject(err); });
    });
  });
}

// Иконки, manifest — сразу из кэша, в фоне обновляем.
function cacheFirst(event) {
  const req = event.request;
  const network = fetchAndCache(req);
  return caches.match(req).then(function (cached) {
    if (cached) {
      event.waitUntil(network.catch(function (e) { console.error('SW background update:', e); }));
      return cached;
    }
    return network;
  });
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const isOwnOrigin = req.url.indexOf(self.location.origin) === 0;

  // «Бонусы»/«Остатки» (запросы с ключом пароля) — только сеть, в кэш телефона не кладём.
  if (req.url.indexOf('token=') !== -1) return;

  if (!isOwnOrigin) {
    // Данные из Apps Script (?action=getBoard/getDealDetail): свежие из сети,
    // без связи — последний сохранённый ответ. Приложение при этом уже
    // показывает данные из localStorage и сеть не ждёт.
    event.respondWith(networkFirst(req));
  } else if (req.mode === 'navigate') {
    event.respondWith(navigate(event));
  } else {
    event.respondWith(cacheFirst(event));
  }
});
