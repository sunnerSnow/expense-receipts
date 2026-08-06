import { existsSync } from "node:fs";
import path from "node:path";
import { toStorageKey } from "@expense-receipts/core";

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

/**
 * 把資料庫裡存的檔案位置解析成「這台機器上」的絕對路徑。
 *
 * 資料庫裡可能是新格式(相對鍵值)或舊格式(某台機器上的絕對路徑),兩種都吃 ——
 * 一律換算成相對於 `rootDir` 的位置。專案搬家、換使用者名稱、搬進容器之後,
 * 舊資料照樣讀得到(見 ADR-0007)。
 *
 * @returns 絕對路徑;無法安全解析或會逃出 `rootDir` 時回 `null`
 */
export function resolveStoredFile(stored: string, rootDir: string): string | null {
  const root = path.resolve(rootDir);
  const key = toStorageKey(stored, path.basename(root));
  if (key === null) return null;

  const resolved = path.resolve(root, ...key.split("/"));
  // 二道防線:toStorageKey 已擋掉 ..,這裡再確認結果真的落在根目錄內
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
