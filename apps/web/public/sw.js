/*
  Service worker:只為了一件事 —— 讓「離線拍收據」那一頁在完全沒網路時也打得開。

  刻意**不**做全站離線快取:其他頁面都是登入後的伺服器渲染內容,快取起來既有
  隱私疑慮,又會讓使用者看到過期的單據列表而誤以為資料不見了。

  快取策略:
  - /_next/static/*  內容雜湊檔名,永不變動 → cache first
  - 離線拍照頁的 HTML → network first,連不上才用快取(確保線上時拿到最新版)
  - 其他所有請求  → 一律走網路,service worker 不插手
*/

const VERSION = "v1";
const SHELL_CACHE = `offline-shell-${VERSION}`;
const ASSET_CACHE = `static-assets-${VERSION}`;

/** 唯一需要離線可用的頁面 */
const OFFLINE_PAGE = "/receipts/new/offline";

/**
 * 安裝時把離線頁與它的 JS/CSS 抓下來。
 *
 * chunk 檔名帶建置雜湊,寫不進這個檔案 —— 所以改成抓 HTML 回來,從裡面把
 * /_next/static/ 的 URL 撈出來一起快取。這樣不必引入建置期的 precache 外掛。
 */
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);

  const res = await fetch(OFFLINE_PAGE, { credentials: "include" });
  // 沒登入會被導去 /login;那份 HTML 快取起來只會害人,寧可不裝
  if (!res.ok || res.redirected) return;

  const html = await res.clone().text();
  await shell.put(OFFLINE_PAGE, res);

  const urls = new Set();
  for (const m of html.matchAll(/["'(](\/_next\/static\/[^"')\s]+)["')]/g)) {
    urls.add(m[1]);
  }
  await Promise.all(
    [...urls].map((u) => assets.add(u).catch(() => undefined)),
  );
}

self.addEventListener("install", (event) => {
  /*
    precache 失敗**不能**讓安裝失敗。

    install 事件一旦 reject,整個 service worker 會被丟棄、註冊消失 ——
    連 runtime 快取都沒了。而 CacheStorage 本來就可能用不了(無痕視窗、
    儲存空間政策、瀏覽器內部錯誤),那時我們寧可退化成「線上才開得了頁面」,
    也不要整個 SW 不存在。踩過一次:headless 測試環境的 CacheStorage 壞掉,
    註冊完馬上消失,查了一輪才發現是 install 被 reject。

    真的沒 precache 到也還有救:離線頁第一次線上開啟時,fetch handler 的
    networkFirst 會把它補進快取。
  */
  event.waitUntil(
    precache()
      .catch(() => undefined)
      // 新版 SW 立刻取代舊的,不必等所有分頁關掉
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** 線上時順手更新快取,讓下次離線拿到的是新版 */
/** 快取寫入一律 best-effort:寫不進去不該讓請求失敗 */
async function putSafe(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    /* CacheStorage 不可用就算了 */
  }
}

async function matchSafe(request, options) {
  try {
    return await caches.match(request, options);
  } catch {
    return undefined;
  }
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) await putSafe(cacheName, request, res.clone());
    return res;
  } catch (err) {
    const cached = await matchSafe(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await matchSafe(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) await putSafe(cacheName, request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // 補送是 POST,而且必須真的到伺服器 —— 絕對不要碰它
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (request.mode === "navigate" && url.pathname === OFFLINE_PAGE) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});
