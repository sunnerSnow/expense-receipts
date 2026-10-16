import {
  isUploadId,
  parseRelayUploadMeta,
  RELAY_META_HEADER,
  type RelayUploadMeta,
} from "@expense-receipts/core";
import type { AiReceiptInput } from "@expense-receipts/intake";

/**
 * 從雲端中繼站把照片拉回本機建單(ADR-0009)。
 *
 * 中繼站只收件,不碰資料庫;單據一律在這裡經 `@expense-receipts/intake` 建立,
 * 與上傳頁、離線補送走同一份流程(鐵律 3:落在 pending_review)。
 *
 * **刪除的時機是唯一要緊的事(鐵律 6)**:本機建單成功、或確認這個 UUID 已經
 * 建過,才回頭刪中繼站那一件。在那之前,中繼站那份是這張憑證唯一的副本 ——
 * 手機佇列在送達中繼站時就刪了。任何看不懂、建不起來的件一律**留在中繼站**,
 * 下次再試,絕不為了「清乾淨」而刪。
 */

export interface RelayItem {
  id: string;
  meta: RelayUploadMeta | null;
}

/** 中繼站的 HTTP 介面;測試時換成記憶體版 */
export interface RelayClient {
  list(cursor: string | null): Promise<{ items: RelayItem[]; cursor: string | null }>;
  /** 已經不在(例如剛被刪)回 null */
  fetch(id: string): Promise<{ image: Blob; meta: RelayUploadMeta | null } | null>;
  delete(id: string): Promise<void>;
}

export interface PullDeps {
  client: RelayClient;
  receiptExists: (id: string) => Promise<boolean>;
  /** `@expense-receipts/intake` 的 createAiReceiptRecord(已綁好 DB/目錄/派工) */
  createReceipt: (input: AiReceiptInput) => Promise<void>;
}

export interface PullSummary {
  /** 這次建成單據的件 */
  imported: string[];
  /** 本機早就有的件(重送、上次刪除沒成功),只是回頭刪中繼站 */
  duplicates: string[];
  /** 留在中繼站沒動的件與原因 —— 都要記進 log,代表需要人看 */
  left: { id: string; reason: string }[];
}

const PULL_TIMEOUT_MS = 120_000;

export function httpRelayClient(baseUrl: string, pullToken: string): RelayClient {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${pullToken}` };

  return {
    async list(cursor) {
      const url = new URL(`${base}/uploads`);
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      // 只帶狀態碼,不把回應或請求(含權杖)整包丟進錯誤訊息
      if (!res.ok) throw new Error(`列出中繼站的件失敗:HTTP ${res.status}`);
      const body = (await res.json()) as { items?: { id?: unknown; meta?: unknown }[]; cursor?: unknown };
      return {
        items: (body.items ?? []).map((item) => ({
          id: String(item.id ?? ""),
          meta: parseRelayUploadMeta(item.meta),
        })),
        cursor: typeof body.cursor === "string" ? body.cursor : null,
      };
    },

    async fetch(id) {
      const res = await fetch(`${base}/uploads/${id}`, {
        headers,
        signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`取件失敗:HTTP ${res.status}`);
      let meta: RelayUploadMeta | null = null;
      try {
        meta = parseRelayUploadMeta(JSON.parse(decodeURIComponent(res.headers.get(RELAY_META_HEADER) ?? "null")));
      } catch {
        // 標頭壞掉就退回 list 時拿到的 metadata
      }
      return { image: await res.blob(), meta };
    },

    async delete(id) {
      const res = await fetch(`${base}/uploads/${id}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok && res.status !== 404) throw new Error(`刪除中繼站的件失敗:HTTP ${res.status}`);
    },
  };
}

/**
 * 拉一輪:列出中繼站所有的件,逐件建單、成功才刪。
 *
 * 逐件序列處理:每件是幾 MB 的照片,而且建單會派 AI 辨識工作,
 * 一次灌太多只會撞 Gemini 的每分鐘限流(那邊有退避重試,但沒必要去撞)。
 *
 * 列出失敗(中繼站連不到)直接丟出去,由呼叫端記錄,下一輪再試。
 * 單一件失敗不影響其他件。
 */
export async function pullFromRelay(deps: PullDeps): Promise<PullSummary> {
  const summary: PullSummary = { imported: [], duplicates: [], left: [] };
  let cursor: string | null = null;

  do {
    const page = await deps.client.list(cursor);

    for (const item of page.items) {
      if (!isUploadId(item.id)) {
        summary.left.push({ id: item.id, reason: "id 不是 UUID" });
        continue;
      }

      try {
        // 已經建過(手機重送、或上一輪建好了但刪除沒成功):只要回頭刪掉
        if (await deps.receiptExists(item.id)) {
          await deps.client.delete(item.id);
          summary.duplicates.push(item.id);
          continue;
        }

        const got = await deps.client.fetch(item.id);
        if (!got) continue; // 列出之後就不在了(KV 最終一致),不是錯誤

        const meta = got.meta ?? item.meta;
        if (!meta) {
          // 沒有經手人就建不了單 —— 留著讓人看,不刪(那是憑證)
          summary.left.push({ id: item.id, reason: "metadata 讀不懂(缺經手人或格式)" });
          continue;
        }

        await deps.createReceipt({
          id: item.id,
          uploaderId: meta.uploaderId,
          image: got.image,
          mimeType: meta.mimeType,
          categoryId: null, // 跟離線頁一樣不選分類,由 AI 建議、回來核對
          note: meta.note,
        });
        // 本機存好了,中繼站那份才可以刪(鐵律 6)
        await deps.client.delete(item.id);
        summary.imported.push(item.id);
      } catch (err) {
        const message = (err as Error)?.message ?? "未知錯誤";
        // 建單撞主鍵(另一輪同時建好了)也算收到:確認存在就刪
        try {
          if (await deps.receiptExists(item.id)) {
            await deps.client.delete(item.id);
            summary.duplicates.push(item.id);
            continue;
          }
        } catch {
          // 連確認都做不了就照失敗處理,下一輪再來
        }
        // 例如 uploaderId 對不到使用者(外鍵)、影像寫不進磁碟:留在中繼站
        summary.left.push({ id: item.id, reason: message });
      }
    }

    cursor = page.cursor;
  } while (cursor);

  return summary;
}
