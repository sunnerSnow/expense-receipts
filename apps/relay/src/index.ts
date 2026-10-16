import { handle } from "./handler";
import { kvUploadStore } from "./kv-store";

/**
 * Cloudflare Worker 入口:只負責把環境接到 handler。
 *
 * 密鑰與允許來源都走 `wrangler secret put`(本機開發用 .dev.vars),不寫進
 * wrangler.toml —— 那個檔案會進版控(鐵律 8)。允許來源是本機的 Tailscale 網址,
 * 不是機密,但也沒有理由公開。
 */
interface Env {
  UPLOADS: KVNamespace;
  RELAY_SECRET?: string;
  RELAY_PULL_TOKEN?: string;
  /** 逗號分隔,例如 `https://desktop.tailnet.ts.net,http://localhost:3000` */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(req, env) {
    try {
      return await handle(req, kvUploadStore(env.UPLOADS), {
        relaySecret: env.RELAY_SECRET ?? "",
        pullToken: env.RELAY_PULL_TOKEN ?? "",
        allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((s) => s.trim().replace(/\/+$/, ""))
          .filter(Boolean),
      });
    } catch (err) {
      // 只記訊息:不要把請求(含憑證)或照片整包丟進 log
      console.error(`[中繼站] 未預期錯誤:${(err as Error)?.message ?? "未知錯誤"}`);
      return new Response(JSON.stringify({ error: "中繼站內部錯誤" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
