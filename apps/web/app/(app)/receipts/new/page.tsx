import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { categories } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { UploadForm } from "./UploadForm";

export default async function NewReceiptPage() {
  const cats = await getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder));

  return (
    <>
      <h1>上傳單據</h1>
      <p className="muted small">
        偵測到電子發票條碼會自動帶入欄位並直接入帳;其他單據交給 AI 辨識或手動輸入。
      </p>
      <UploadForm categories={cats} />
      <p className="small muted">
        出差在外、電腦沒開?用 <Link href="/receipts/new/offline">離線拍收據</Link>{" "}
        先存在手機裡,回來自動補送。
      </p>
    </>
  );
}
