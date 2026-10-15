import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@expense-receipts/db";
import { createAiReceiptRecord, extFromType, saveReceiptImage, type IntakeDeps } from "./index";

/**
 * 只記錄呼叫的假 DB。
 *
 * 這裡要驗的是「寫了什麼值」(鐵律 3 的 pending_review、派工失敗的寫回),
 * 不是 drizzle 本身 —— 所以只做出 insert().values() 與 update().set().where()
 * 這兩條鏈。
 */
function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row);
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          updated.push(patch);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, inserted, updated };
}

const ID = "3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";

let uploadDir: string;

beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "intake-test-"));
});

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

describe("extFromType", () => {
  it("常見影像格式對到正確副檔名", () => {
    expect(extFromType("image/png")).toBe("png");
    expect(extFromType("image/webp")).toBe("webp");
    expect(extFromType("image/heic")).toBe("heic");
    expect(extFromType("image/heif")).toBe("heif");
    expect(extFromType("image/jpeg")).toBe("jpg");
  });

  it("不認得的格式退回 jpg", () => {
    expect(extFromType("")).toBe("jpg");
    expect(extFromType("application/octet-stream")).toBe("jpg");
  });
});

describe("saveReceiptImage", () => {
  it("寫進 uploadDir,回傳相對鍵值而不是絕對路徑(ADR-0007)", async () => {
    const key = await saveReceiptImage(uploadDir, new Blob(["fake-heic"]), ID, "image/heic");
    expect(key).toBe(`${ID}.heic`);
    expect(path.isAbsolute(key)).toBe(false);
    expect(await readFile(path.join(uploadDir, key), "utf8")).toBe("fake-heic");
  });

  it("目錄不存在時自己建", async () => {
    const nested = path.join(uploadDir, "not", "yet");
    const key = await saveReceiptImage(nested, new Blob(["x"]), ID, "image/png");
    expect(await readFile(path.join(nested, key), "utf8")).toBe("x");
  });
});

describe("createAiReceiptRecord", () => {
  const input = {
    id: ID,
    uploaderId: "user-1",
    image: new Blob(["jpeg-bytes"]),
    mimeType: "image/jpeg",
    categoryId: null,
    note: "客戶 A 晚餐",
  };

  it("落在 pending_review、source=ai、辨識排隊中,並派工(鐵律 3)", async () => {
    const { db, inserted, updated } = fakeDb();
    const sent: unknown[] = [];
    const deps: IntakeDeps = {
      db,
      uploadDir,
      sendRecognizeJob: async (payload) => {
        sent.push(payload);
      },
    };

    await createAiReceiptRecord(deps, input);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: ID,
      uploaderId: "user-1",
      source: "ai",
      status: "pending_review",
      recognitionStatus: "queued",
      note: "客戶 A 晚餐",
      imagePath: `${ID}.jpg`,
    });
    expect(sent).toEqual([{ receiptId: ID }]);
    expect(updated).toHaveLength(0);
    // 影像先落地:派工時 worker 要讀得到
    expect(await readFile(path.join(uploadDir, `${ID}.jpg`), "utf8")).toBe("jpeg-bytes");
  });

  it("派工失敗時寫回 failed 與原因,不讓單據永遠停在辨識中", async () => {
    const { db, inserted, updated } = fakeDb();
    const deps: IntakeDeps = {
      db,
      uploadDir,
      sendRecognizeJob: async () => {
        throw new Error("pg-boss 連不上");
      },
    };

    await createAiReceiptRecord(deps, input);

    expect(inserted).toHaveLength(1);
    expect(updated).toEqual([
      {
        recognitionStatus: "failed",
        recognitionError: "辨識工作派送失敗:pg-boss 連不上",
      },
    ]);
    // 寫回的只有辨識狀態,不碰 status 狀態機(鐵律 3)
    expect(updated[0]).not.toHaveProperty("status");
  });
});
