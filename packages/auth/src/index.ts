/**
 * 密碼雜湊 —— 只用 Node 內建的 scrypt,不引入原生編譯的套件(見 ADR-0006)。
 *
 * 為什麼獨立成一個 package 而不是放 `packages/core`:core 會被瀏覽器端 bundle,
 * 一旦 import `node:crypto` 就會在客戶端編譯失敗。這個坑已經在 `packages/config`
 * 的 `node:fs` 上踩過一次(見 docs/conventions.md 第 8 節)。
 * 這裡只有 web 的 server 端與 db 的 CLI 會用到。
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * promisify 只會挑到 scrypt 的 3 參數多載(password, salt, keylen, callback),
 * 帶 options 的那個多載會被漏掉,所以明確標出型別。
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt 成本參數。
 *
 * N=2^15、r=8、p=1 在一般機器上約 50–100ms —— 對登入是可接受的延遲,
 * 對暴力破解是有意義的成本。參數會寫進雜湊字串,日後調高不會讓舊密碼失效。
 */
const PARAMS = { N: 1 << 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";

/**
 * scrypt 需要的記憶體是 128 × N × r。
 *
 * Node 預設 maxmem 只有 32MB,而 N=2^15、r=8 就需要 33.5MB —— 不明確給
 * maxmem 會直接丟 `memory limit exceeded`。上限訂 128MB:夠用到 N=2^17,
 * 又不會讓被動過的雜湊字串把程序的記憶體吃光。
 */
const MAX_MEMORY = 128 * 1024 * 1024;

function memoryFor(N: number, r: number): number {
  return 128 * N * r;
}

/** 儲存格式:scrypt$N$r$p$salt$hash(salt 與 hash 都是 base64) */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(plain.normalize("NFKC"), salt, KEY_LENGTH, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEMORY,
  });

  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * 驗證密碼。
 *
 * 任何格式問題一律回 false(不丟例外):呼叫端只需要處理「過/不過」,
 * 而把「雜湊格式壞了」與「密碼錯了」分開回報只會洩漏帳號狀態。
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // 擋掉離譜的參數:壞掉或被動過的字串不該讓程序耗盡記憶體
  if (N < 1024 || r < 1 || p < 1 || p > 16) return false;
  if (memoryFor(N, r) > MAX_MEMORY) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, "base64");
    const salt = Buffer.from(saltB64, "base64");
    if (expected.length === 0 || salt.length === 0) return false;
    actual = await scryptAsync(plain.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 假比對:帳號不存在或沒設密碼時也跑一次,讓回應時間不洩漏帳號是否存在。
 *
 * 沒有這一步的話,「email 不存在」會比「密碼錯誤」快上約 100ms,
 * 等於提供一個列舉帳號的側通道。
 */
const DUMMY_HASH = [PREFIX, PARAMS.N, PARAMS.r, PARAMS.p, "AAAAAAAAAAAAAAAAAAAAAA==", "AA=="].join(
  "$",
);

export async function burnPasswordTime(plain: string): Promise<void> {
  await verifyPassword(plain, DUMMY_HASH);
}

/**
 * 產生可以念給人聽的隨機密碼。
 *
 * 沒有寄信管道(見 ADR-0006),所以初始密碼與重設密碼都得由管理者轉達 ——
 * 密碼要好念、好打、不會看錯。因此:
 * - 排除容易混淆的字元(0/O、1/l/I)
 * - 用連字號分段,口述與手打都比一長串容易
 * - 取樣避開 modulo bias(雖然這裡影響極小,但沒理由寫成有偏差的版本)
 */
const SAFE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 個字元
const GENERATED_GROUPS = 3;
const GENERATED_GROUP_SIZE = 5;

export function generatePassword(): string {
  const total = GENERATED_GROUPS * GENERATED_GROUP_SIZE;
  const chars: string[] = [];
  // 32 整除 256,所以直接取 modulo 沒有偏差;仍明確寫出這個前提
  if (256 % SAFE_ALPHABET.length !== 0) throw new Error("字元表長度必須整除 256 才無取樣偏差");

  while (chars.length < total) {
    for (const byte of randomBytes(total)) {
      chars.push(SAFE_ALPHABET[byte % SAFE_ALPHABET.length] as string);
      if (chars.length === total) break;
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < GENERATED_GROUPS; i += 1) {
    groups.push(chars.slice(i * GENERATED_GROUP_SIZE, (i + 1) * GENERATED_GROUP_SIZE).join(""));
  }
  return groups.join("-");
}
