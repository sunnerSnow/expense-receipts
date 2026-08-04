import { existsSync } from "node:fs";
import path from "node:path";

/** monorepo 根目錄的標記檔 */
const ROOT_MARKER = "pnpm-workspace.yaml";

/**
 * 把相對路徑解析成「以 monorepo 根目錄為基準」的絕對路徑。
 *
 * 動機:web 與 worker 的 cwd 不同(apps/web vs apps/worker),同一個
 * `UPLOAD_DIR=./uploads` 會指到兩個不同資料夾 —— 結果就是「web 上傳得到、
 * worker 辨識時讀不到影像」這種難查的錯。統一以根目錄為基準就沒這問題。
 *
 * 絕對路徑原樣回傳(部署時建議直接給絕對路徑或掛載點)。
 */
export function resolveFromRepoRoot(target: string, from: string = process.cwd()): string {
  if (path.isAbsolute(target)) return target;

  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, ROOT_MARKER))) return path.resolve(dir, target);
    const parent = path.dirname(dir);
    if (parent === dir) break; // 到檔案系統根了還沒找到
    dir = parent;
  }
  // 找不到標記檔就退回相對於 cwd(單獨執行某個 package 時的行為)
  return path.resolve(from, target);
}
