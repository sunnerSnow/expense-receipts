/**
 * 檔案位置的正規化。
 *
 * 背景:`receipts.image_path` 與 `export_batches.file_path` 早期存的是**絕對路徑**
 * (`C:\Users\Uanalyze\Project\expense-receipts\uploads\x.jpg`)。只要專案換位置 ——
 * 換電腦、換使用者名稱、搬進容器、搬上 VPS —— 這些路徑就全部失效,單據影像
 * 與匯出檔通通讀不到。而影像是報帳憑證,讀不到等於憑證遺失。
 *
 * 修法不能靠改資料:`export_batches` 只允許 INSERT、已匯出的單據不可修改
 * (鐵律 5)。所以改成**讀取時正規化**:不論資料庫裡存的是新格式(相對鍵值)
 * 還是舊格式(絕對路徑),都換算成「相對於目前儲存根目錄」的鍵值,再由呼叫端
 * 組成這台機器上的實際路徑。零寫入,兩種格式永久並存。
 *
 * 見 ADR-0007。
 */

/** Windows 磁碟機代號,如 `C:` */
const DRIVE_LETTER = /^[a-zA-Z]:$/;

/** 絕對路徑:以 / 開頭(POSIX)或以磁碟機代號開頭(Windows) */
const ABSOLUTE = /^\/|^[a-zA-Z]:/;

/**
 * 把資料庫裡存的檔案位置換算成「相對於儲存根目錄」的鍵值,一律用 `/` 分隔。
 *
 * @param stored     資料庫裡的值(可能是絕對路徑,也可能已經是鍵值)
 * @param rootDirName 儲存根目錄的**目錄名**(如 `uploads`、`exports`),
 *                    不是完整路徑 —— 呼叫端用 `path.basename(UPLOAD_DIR)` 取得
 * @returns 鍵值(如 `a.jpg`、`2026-07/清單.csv`);無法安全解析時回 `null`
 *
 * 判斷順序:
 * 1. 從後往前找等於 `rootDirName` 的路徑片段,取它後面的部分 —— 這能同時處理
 *    Windows 與 POSIX 的舊絕對路徑,也處理根目錄搬到別處的情況
 * 2. 找不到而且本來就是相對路徑 → 它已經是鍵值,原樣沿用
 * 3. 找不到而且是絕對路徑 → 只能退回檔名。`uploads` 是平的目錄,這樣仍然正確;
 *    `exports` 有期間子目錄會失準,但實務上那個路徑一定是由 EXPORT_DIR 組出來的,
 *    片段必然找得到
 */
export function toStorageKey(stored: string, rootDirName: string): string | null {
  const slashed = stored.replace(/\\/g, "/").trim();
  if (slashed === "") return null;

  const isAbsolute = ABSOLUTE.test(slashed);
  const segments = slashed.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return null;

  const rootName = rootDirName
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .pop();

  let tail = segments;
  let matchedRoot = false;

  if (rootName !== undefined && rootName !== "..") {
    const wanted = rootName.toLowerCase();
    // 最後一段是檔名,不參與比對;從後往前找,取最靠近檔案的那一層根目錄
    for (let i = segments.length - 2; i >= 0; i -= 1) {
      if (segments[i]!.toLowerCase() === wanted) {
        tail = segments.slice(i + 1);
        matchedRoot = true;
        break;
      }
    }
  }

  if (!matchedRoot && isAbsolute) {
    tail = [segments[segments.length - 1]!];
  }

  if (tail.length === 0) return null;
  // 路徑逃逸與殘留的磁碟機代號一律拒絕,不要組出根目錄外的路徑
  if (tail.some((s) => s === ".." || DRIVE_LETTER.test(s))) return null;

  return tail.join("/");
}
