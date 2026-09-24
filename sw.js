'use strict';

/* =========================================================
   DELTA HUE — Service Worker（id とキャッシュ名は旧名の hue-hunter のまま）
   インストール可能にするための最小構成＋オフライン起動。
   自前のファイルは network-first（更新をすぐ反映し、圏外ではキャッシュで動く）。
   Google Fonts だけ stale-while-revalidate で持つ。
   Firebase など他のオリジンには一切触らない。
   ========================================================= */

// キャッシュ名はアプリ名で始める（同じオリジンの他アプリのキャッシュと区別するため）
const PREFIX = 'hue-hunter-';
const VERSION = PREFIX + '2.5.3'; // index.html の #version と揃える
const LEGACY = /^hh-\d/; // 以前このアプリが使っていたキャッシュ名（hh-2.5.0 など）
const SHELL = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    './icons/favicon-32.png',
    './icons/apple-touch-icon.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((k) => (k.startsWith(PREFIX) || LEGACY.test(k)) && k !== VERSION)
                .map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        e.respondWith(networkFirst(req));
    } else if (FONT_HOSTS.includes(url.hostname)) {
        e.respondWith(staleWhileRevalidate(req));
    }
    // それ以外（Firebase）はブラウザに任せる
});

async function networkFirst(req) {
    const cache = await caches.open(VERSION);
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
    } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('./index.html');
        throw err;
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const fresh = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
    }).catch(() => hit);
    return hit || fresh;
}
