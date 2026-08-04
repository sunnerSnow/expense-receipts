import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { categories, receipts } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { ReceiptDetail } from "./ReceiptDetail";

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const rows = await db.select().from(receipts).where(eq(receipts.id, id)).limit(1);
  const rec = rows[0];
  if (!rec) notFound();

  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder));

  return (
    <ReceiptDetail
      categories={cats}
      receipt={{
        id: rec.id,
        status: rec.status,
        docType: rec.docType,
        source: rec.source,
        invoiceNumber: rec.invoiceNumber,
        invoiceDate: rec.invoiceDate,
        sellerName: rec.sellerName,
        sellerTaxId: rec.sellerTaxId,
        buyerTaxId: rec.buyerTaxId,
        currency: rec.currency,
        amount: rec.amount,
        taxAmount: rec.taxAmount,
        deductibility: rec.deductibility,
        categoryId: rec.categoryId,
        note: rec.note,
        hasImage: rec.imagePath !== null,
        recognitionStatus: rec.recognitionStatus,
        recognitionError: rec.recognitionError,
        recognitionWarnings: rec.recognitionWarnings ?? null,
      }}
    />
  );
}
