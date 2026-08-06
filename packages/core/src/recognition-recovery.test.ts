import { describe, expect, it } from "vitest";
import {
  RECOGNITION_STALE_AFTER_MS,
  selectLostRecognitions,
  type QueuedRecognition,
} from "./recognition-recovery";

const NOW = new Date("2026-08-06T10:00:00Z");

/** 距離 NOW 幾分鐘前 */
function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60 * 1000);
}

function queued(receiptId: string, ago: number): QueuedRecognition {
  return { receiptId, updatedAt: minutesAgo(ago) };
}

describe("selectLostRecognitions", () => {
  it("佇列裡還有工作的單據不動", () => {
    expect(
      selectLostRecognitions({
        queued: [queued("a", 120)],
        liveJobReceiptIds: ["a"],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("找不到對應工作且已超過門檻 → 判定為孤兒", () => {
    expect(
      selectLostRecognitions({
        queued: [queued("a", 120)],
        liveJobReceiptIds: [],
        now: NOW,
      }),
    ).toEqual(["a"]);
  });

  it("剛派工的不碰:避開 web 送出與 worker 掃描之間的競態", () => {
    expect(
      selectLostRecognitions({
        queued: [queued("a", 1)],
        liveJobReceiptIds: [],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("剛好落在門檻上算孤兒(邊界含等於)", () => {
    const at = new Date(NOW.getTime() - RECOGNITION_STALE_AFTER_MS);
    expect(
      selectLostRecognitions({
        queued: [{ receiptId: "a", updatedAt: at }],
        liveJobReceiptIds: [],
        now: NOW,
      }),
    ).toEqual(["a"]);
  });

  it("混合情境:只挑出真正沒工作又夠久的,並保持輸入順序", () => {
    expect(
      selectLostRecognitions({
        queued: [queued("old-lost", 300), queued("has-job", 300), queued("fresh", 2), queued("also-lost", 60)],
        liveJobReceiptIds: ["has-job"],
        now: NOW,
      }),
    ).toEqual(["old-lost", "also-lost"]);
  });

  it("同一張單據重複出現只回傳一次", () => {
    expect(
      selectLostRecognitions({
        queued: [queued("a", 60), queued("a", 90)],
        liveJobReceiptIds: [],
        now: NOW,
      }),
    ).toEqual(["a"]);
  });

  it("updatedAt 壞掉時傾向救援,而不是讓單據永遠卡住", () => {
    expect(
      selectLostRecognitions({
        queued: [{ receiptId: "a", updatedAt: new Date("not a date") }],
        liveJobReceiptIds: [],
        now: NOW,
      }),
    ).toEqual(["a"]);
  });

  it("沒有 queued 單據時回空陣列", () => {
    expect(
      selectLostRecognitions({ queued: [], liveJobReceiptIds: ["a"], now: NOW }),
    ).toEqual([]);
  });

  it("可以自訂門檻", () => {
    const args = { queued: [queued("a", 3)], liveJobReceiptIds: [], now: NOW };
    expect(selectLostRecognitions({ ...args, staleAfterMs: 60 * 1000 })).toEqual(["a"]);
    expect(selectLostRecognitions({ ...args, staleAfterMs: 10 * 60 * 1000 })).toEqual([]);
  });

  it("門檻給了負數或 NaN 就退回預設值,不會變成全部重派", () => {
    const args = { queued: [queued("a", 3)], liveJobReceiptIds: [], now: NOW };
    expect(selectLostRecognitions({ ...args, staleAfterMs: -1 })).toEqual([]);
    expect(selectLostRecognitions({ ...args, staleAfterMs: Number.NaN })).toEqual([]);
  });
});
