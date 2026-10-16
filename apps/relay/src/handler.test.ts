import { describe, expect, it } from "vitest";
import type { RelayUploadMeta } from "@expense-receipts/core";
import { signRelayCredential } from "@expense-receipts/auth/relay-credential";
import { handle, META_HEADER, type RelayConfig, type UploadStore } from "./handler";

const RELAY_SECRET = "relay-secret-for-tests-0123456789abcdef";
const PULL_TOKEN = "pull-token-for-tests-0123456789abcdefgh";
const ORIGIN = "https://office.example.ts.net";
const USER = "8d0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";
const ID = "3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const BASE = "https://relay.example.workers.dev";

const config: RelayConfig = {
  relaySecret: RELAY_SECRET,
  pullToken: PULL_TOKEN,
  allowedOrigins: [ORIGIN],
  now: () => NOW,
};

/** 記憶體版的 KV;failPut 模擬免費額度用完 */
function memoryStore(opts: { failPut?: boolean } = {}) {
  const items = new Map<string, { image: ArrayBuffer; meta: RelayUploadMeta }>();
  const store: UploadStore = {
    async put(id, image, meta) {
      if (opts.failPut) throw new Error("KV put() limit exceeded for the day");
      items.set(id, { image, meta });
    },
    async list() {
      return { items: [...items].map(([id, v]) => ({ id, meta: v.meta })), cursor: null };
    },
    async get(id) {
      return items.get(id) ?? null;
    },
    async delete(id) {
      items.delete(id);
    },
  };
  return { store, items };
}

async function credential(secret = RELAY_SECRET, userId = USER): Promise<string> {
  return signRelayCredential(secret, userId, NOW);
}

function uploadForm(fields: { id?: string; note?: string; type?: string; body?: string } = {}) {
  const form = new FormData();
  form.set("id", fields.id ?? ID);
  form.set("note", fields.note ?? "客戶 A 晚餐");
  form.set(
    "image",
    new File([fields.body ?? "jpeg-bytes"], "receipt", { type: fields.type ?? "image/jpeg" }),
  );
  return form;
}

async function upload(
  store: UploadStore,
  init: { token?: string | null; form?: FormData; origin?: string | null } = {},
) {
  const headers = new Headers();
  const token = init.token === undefined ? await credential() : init.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin) headers.set("origin", origin);
  return handle(
    new Request(`${BASE}/uploads`, { method: "POST", headers, body: init.form ?? uploadForm() }),
    store,
    config,
  );
}

function pull(store: UploadStore, path: string, method = "GET", token: string | null = PULL_TOKEN) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return handle(new Request(`${BASE}${path}`, { method, headers }), store, config);
}

describe("收件(POST /uploads)", () => {
  it("帶有效憑證就收下,經手人取自憑證、備註正規化", async () => {
    const { store, items } = memoryStore();
    const res = await upload(store, { form: uploadForm({ note: "  客戶 A 晚餐 " }) });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: ID });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(items.get(ID)?.meta).toEqual({
      uploaderId: USER,
      mimeType: "image/jpeg",
      note: "客戶 A 晚餐",
      receivedAt: NOW,
    });
    expect(new TextDecoder().decode(items.get(ID)?.image)).toBe("jpeg-bytes");
  });

  it("請求本文自稱別人也沒用:經手人只看憑證", async () => {
    const { store, items } = memoryStore();
    const form = uploadForm();
    form.set("uploaderId", "someone-else");
    await upload(store, { form });
    expect(items.get(ID)?.meta.uploaderId).toBe(USER);
  });

  it("同一個 id 重送是覆寫同一件,不會變兩件", async () => {
    const { store, items } = memoryStore();
    await upload(store);
    const again = await upload(store);
    expect(again.status).toBe(201);
    expect(items.size).toBe(1);
  });

  it("沒帶憑證、密鑰不對、或拿拉取權杖來上傳 → 401", async () => {
    const { store, items } = memoryStore();
    expect((await upload(store, { token: null })).status).toBe(401);
    expect(
      (await upload(store, { token: await credential("a-different-secret-0123456789abcdef") }))
        .status,
    ).toBe(401);
    expect((await upload(store, { token: PULL_TOKEN })).status).toBe(401);
    expect(items.size).toBe(0);
  });

  it("照片本身有問題 → 4xx(手機會標成失敗讓使用者處理)", async () => {
    const { store, items } = memoryStore();
    expect((await upload(store, { form: uploadForm({ id: "abc" }) })).status).toBe(400);
    expect((await upload(store, { form: uploadForm({ type: "application/pdf" }) })).status).toBe(415);
    expect((await upload(store, { form: uploadForm({ note: "字".repeat(201) }) })).status).toBe(400);
    expect(items.size).toBe(0);
  });

  it("不是本機 web 的網頁來源 → 403,而且不回 CORS 標頭", async () => {
    const { store, items } = memoryStore();
    const res = await upload(store, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(items.size).toBe(0);
  });

  it("寫入失敗(例如 KV 當日額度用完)→ 503,照片留在手機稍後再送", async () => {
    const { store } = memoryStore({ failPut: true });
    expect((await upload(store)).status).toBe(503);
  });

  it("CORS 預檢:允許的來源回 204 與標頭", async () => {
    const { store } = memoryStore();
    const res = await handle(
      new Request(`${BASE}/uploads`, { method: "OPTIONS", headers: { origin: ORIGIN } }),
      store,
      config,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});

describe("交件(拉取權杖)", () => {
  it("列出待拉的件,帶 metadata", async () => {
    const { store } = memoryStore();
    await upload(store);
    const res = await pull(store, "/uploads");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          id: ID,
          meta: { uploaderId: USER, mimeType: "image/jpeg", note: "客戶 A 晚餐", receivedAt: NOW },
        },
      ],
      cursor: null,
    });
  });

  it("取件:回照片本體,metadata 在標頭(中文備註經 URI 編碼)", async () => {
    const { store } = memoryStore();
    await upload(store);
    const res = await pull(store, `/uploads/${ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(await res.text()).toBe("jpeg-bytes");
    const meta = JSON.parse(decodeURIComponent(res.headers.get(META_HEADER) ?? ""));
    expect(meta.note).toBe("客戶 A 晚餐");
  });

  it("取不存在的件 → 404;id 不是 UUID 也是 404", async () => {
    const { store } = memoryStore();
    expect((await pull(store, `/uploads/${ID}`)).status).toBe(404);
    expect((await pull(store, "/uploads/not-a-uuid")).status).toBe(404);
  });

  it("刪除後就不在了;重複刪除也回 204(冪等)", async () => {
    const { store, items } = memoryStore();
    await upload(store);
    expect((await pull(store, `/uploads/${ID}`, "DELETE")).status).toBe(204);
    expect(items.size).toBe(0);
    expect((await pull(store, `/uploads/${ID}`, "DELETE")).status).toBe(204);
  });

  it("兩把鑰匙不混用:上傳憑證不能列出、取件或刪除", async () => {
    const { store, items } = memoryStore();
    await upload(store);
    const cred = await credential();
    expect((await pull(store, "/uploads", "GET", cred)).status).toBe(401);
    expect((await pull(store, `/uploads/${ID}`, "GET", cred)).status).toBe(401);
    expect((await pull(store, `/uploads/${ID}`, "DELETE", cred)).status).toBe(401);
    expect((await pull(store, "/uploads", "GET", null)).status).toBe(401);
    expect((await pull(store, "/uploads", "GET", `${PULL_TOKEN}x`)).status).toBe(401);
    expect(items.size).toBe(1);
  });
});

describe("其他", () => {
  it("密鑰沒設或太短 → 整個關門(503)", async () => {
    const { store } = memoryStore();
    const res = await handle(new Request(`${BASE}/uploads`), store, { ...config, pullToken: "short" });
    expect(res.status).toBe(503);
  });

  it("不認得的路徑 → 404、不支援的方法 → 405", async () => {
    const { store } = memoryStore();
    expect((await pull(store, "/")).status).toBe(404);
    expect((await pull(store, "/uploads", "PUT")).status).toBe(405);
    expect((await pull(store, `/uploads/${ID}`, "POST")).status).toBe(405);
  });
});
