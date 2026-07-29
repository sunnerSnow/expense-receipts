import "server-only";
import { createDb, type Db } from "@expense-receipts/db";
import { env } from "./env";

// 單例:整個 web 程序共用一個連線池
let _db: Db | undefined;

export function getDb(): Db {
  if (!_db) _db = createDb(env.DATABASE_URL);
  return _db;
}
