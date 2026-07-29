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
      <p style={{ color: "#666" }}>
        拍照或選擇單據影像。偵測到電子發票條碼會自動帶入欄位;否則請手動輸入。
      </p>
      <UploadForm categories={cats} />
    </>
  );
}
