import { describe, expect, it } from "vitest";
import type { RelayUploadMeta } from "@expense-receipts/core";
import type { AiReceiptInput } from "@expense-receipts/intake";
import { pullFromRelay, type PullDeps, type RelayClient } from "./pull-relay";

const A = "3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";
const B = "8d0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";

const META: RelayUploadMeta = {
  uploaderId: "user-1",
  mimeType: "image/jpeg",
  note: "客戶 A 晚餐",
  receivedAt: 1,
};

/**
 * 記憶體版中繼站 + 本機,並記錄每個動作的順序 ——
 * 要驗的核心是「建單在前、刪除在後」(鐵律 6)。
 */
function setup(opts: {
  relay: Record<string, { meta: RelayUploadMeta | null; listMeta?: RelayUploadMeta | null }>;
  existing?: string[];
  createFails?: (input: AiReceiptInput) => Error | null;
  pages?: string[][];
}) {
  const relay = new Map(Object.entries(opts.relay));
  const local = new Set(opts.existing ?? []);
  const events: string[] = [];
  const created: AiReceiptInput[] = [];

  const pages = opts.pages ?? [[...relay.keys()]];
  const client: RelayClient = {
    async list(cursor) {
      const index = cursor === null ? 0 : Number(cursor);
      const ids = pages[index] ?? [];
      return {
        items: ids.map((id) => ({
          id,
          meta: relay.get(id)?.listMeta !== undefined ? (relay.get(id)?.listMeta ?? null) : (relay.get(id)?.meta ?? null),
        })),
        cursor: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
    async fetch(id) {
      const found = relay.get(id);
      if (!found) return null;
      events.push(`fetch:${id}`);
      return { image: new Blob([`bytes-${id}`]), meta: found.meta };
    },
    async delete(id) {
      events.push(`delete:${id}`);
      relay.delete(id);
    },
  };

  const deps: PullDeps = {
    client,
    receiptExists: async (id) => local.has(id),
    createReceipt: async (input) => {
      const err = opts.createFails?.(input) ?? null;
      if (err) throw err;
      events.push(`create:${input.id}`);
      created.push(input);
      local.add(input.id);
    },
  };

  return { deps, relay, local, events, created };
}

describe("pullFromRelay", () => {
  it("逐件建單,建好之後才刪中繼站那一件(鐵律 6)", async () => {
    const { deps, relay, events, created } = setup({ relay: { [A]: { meta: META } } });

    const summary = await pullFromRelay(deps);

    expect(summary).toEqual({ imported: [A], duplicates: [], left: [] });
    expect(events).toEqual([`fetch:${A}`, `create:${A}`, `delete:${A}`]);
    expect(relay.size).toBe(0);
    expect(created[0]).toMatchObject({
      id: A,
      uploaderId: "user-1",
      mimeType: "image/jpeg",
      note: "客戶 A 晚餐",
      categoryId: null,
    });
    expect(await created[0]?.image.text()).toBe(`bytes-${A}`);
  });

  it("本機早就有這張(重送或上次刪除失敗):不重建,只回頭刪", async () => {
    const { deps, events, created } = setup({ relay: { [A]: { meta: META } }, existing: [A] });

    const summary = await pullFromRelay(deps);

    expect(summary).toEqual({ imported: [], duplicates: [A], left: [] });
    expect(created).toHaveLength(0);
    expect(events).toEqual([`delete:${A}`]);
  });

  it("建單失敗(例如經手人對不到使用者):照片留在中繼站,其他件照常處理", async () => {
    const { deps, relay } = setup({
      relay: { [A]: { meta: { ...META, uploaderId: "ghost" } }, [B]: { meta: META } },
      createFails: (input) =>
        input.uploaderId === "ghost" ? new Error("violates foreign key constraint") : null,
    });

    const summary = await pullFromRelay(deps);

    expect(summary.imported).toEqual([B]);
    expect(summary.left).toEqual([{ id: A, reason: "violates foreign key constraint" }]);
    expect(relay.has(A)).toBe(true);
    expect(relay.has(B)).toBe(false);
  });

  it("建單撞主鍵(另一輪剛好建好):確認存在就當作收到,刪掉", async () => {
    const { deps, local, relay } = setup({
      relay: { [A]: { meta: META } },
      createFails: () => {
        local.add(A); // 模擬另一個程序搶先建好
        return new Error("duplicate key value violates unique constraint");
      },
    });

    const summary = await pullFromRelay(deps);

    expect(summary).toEqual({ imported: [], duplicates: [A], left: [] });
    expect(relay.size).toBe(0);
  });

  it("metadata 讀不懂(沒有經手人):不建單、不刪,留給人看", async () => {
    const { deps, relay, created } = setup({ relay: { [A]: { meta: null, listMeta: null } } });

    const summary = await pullFromRelay(deps);

    expect(created).toHaveLength(0);
    expect(relay.has(A)).toBe(true);
    expect(summary.left).toEqual([{ id: A, reason: "metadata 讀不懂(缺經手人或格式)" }]);
  });

  it("取件時標頭的 metadata 壞掉,退回列出時拿到的那份", async () => {
    const { deps, created } = setup({ relay: { [A]: { meta: null, listMeta: META } } });

    await pullFromRelay(deps);

    expect(created[0]?.uploaderId).toBe("user-1");
  });

  it("列出之後就不在了(KV 最終一致):略過,不算錯", async () => {
    const { deps, relay } = setup({ relay: { [A]: { meta: META } } });
    relay.delete(A); // list 用的是 pages 快照,取件時已經不在

    const summary = await pullFromRelay(deps);

    expect(summary).toEqual({ imported: [], duplicates: [], left: [] });
  });

  it("id 不是 UUID 的件不處理(也不刪)", async () => {
    const { deps, relay } = setup({ relay: { "../etc/passwd": { meta: META } } });

    const summary = await pullFromRelay(deps);

    expect(summary.left).toEqual([{ id: "../etc/passwd", reason: "id 不是 UUID" }]);
    expect(relay.size).toBe(1);
  });

  it("中繼站分頁時每一頁都拉", async () => {
    const { deps } = setup({
      relay: { [A]: { meta: META }, [B]: { meta: META } },
      pages: [[A], [B]],
    });

    const summary = await pullFromRelay(deps);

    expect(summary.imported).toEqual([A, B]);
  });

  it("列出失敗(中繼站連不到)直接丟出去,由呼叫端記錄", async () => {
    const { deps } = setup({ relay: {} });
    deps.client.list = async () => {
      throw new Error("列出中繼站的件失敗:HTTP 503");
    };

    await expect(pullFromRelay(deps)).rejects.toThrow("HTTP 503");
  });
});
