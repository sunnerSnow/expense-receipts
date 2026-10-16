import { parseRelayUploadMeta, type RelayUploadMeta } from "@expense-receipts/core";
import type { UploadStore } from "./handler";

/**
 * Workers KV 版的 UploadStore。
 *
 * 照片是 value,uploader/備註/MIME/收件時間放 metadata —— `list()` 會連 metadata
 * 一起回來,worker 拉取時一次 list 就知道有哪些件、各是誰的。
 *
 * 注意 KV 是最終一致的:剛寫入的件可能要幾十秒才列得出來,剛刪的也可能還列得到。
 * 後者會讓 worker 重複拉到同一件,靠單據主鍵(客戶端 UUID)擋下,不會建成兩筆。
 */

const PREFIX = "upload:";

export function kvUploadStore(kv: KVNamespace): UploadStore {
  return {
    async put(id, image, meta) {
      await kv.put(PREFIX + id, image, { metadata: meta });
    },

    async list(cursor) {
      const page = await kv.list<RelayUploadMeta>({ prefix: PREFIX, cursor });
      return {
        items: page.keys.map((key) => ({
          id: key.name.slice(PREFIX.length),
          meta: parseRelayUploadMeta(key.metadata),
        })),
        cursor: page.list_complete ? null : page.cursor,
      };
    },

    async get(id) {
      const found = await kv.getWithMetadata<RelayUploadMeta>(PREFIX + id, "arrayBuffer");
      if (found.value === null) return null;
      return { image: found.value, meta: parseRelayUploadMeta(found.metadata) };
    },

    async delete(id) {
      await kv.delete(PREFIX + id);
    },
  };
}
