// Service Worker - 英語フレーズ練習 オフライン対応
const CACHE_NAME = 'eigo-v1';
const STATIC_FILES = ['/', '/index.html', '/manifest.json', '/sw.js'];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ処理
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // /api/translate はネットワーク優先、オフライン時はフォールバック
  if (url.pathname === '/api/translate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({
            fallback: true,
            offline: true,
            translations: ['※ オフライン中のため翻訳できません'],
            examples: []
          }),
          { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        )
      )
    );
    return;
  }

  // 静的ファイルはキャッシュ優先
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // 正常なレスポンスをキャッシュに追加
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
