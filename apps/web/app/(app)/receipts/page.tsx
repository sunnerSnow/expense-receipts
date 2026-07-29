import Link from "next/link";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { categories, receipts } from "@expense-receipts/db";
import {
  amountToCents,
  formatCents,
  summarizeReceipts,
  RECEIPT_STATUSES,
  type ReceiptStatus,
} from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import { DEDUCTIBILITY_LABELS, STATUS_LABELS } from "@/lib/labels";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: string; next: string } {
  const [y, m] = month.split("-").map(Number);
  const year = y ?? new Date().getFullYear();
  const mon = m ?? 1;
  const start = `${month}-01`;
  const next =
    mon === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  return { start, next };
}

function isStatus(v: string | undefined): v is ReceiptStatus {
  return v !== undefined && (RECEIPT_STATUSES as readonly string[]).includes(v);
}

const cell = { padding: "0.4rem 0.5rem", borderBottom: "1px solid #eee", textAlign: "left" } as const;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();
  const status = isStatus(sp.status) ? sp.status : undefined;
  const { start, next } = monthBounds(month);

  const conds = [gte(receipts.invoiceDate, start), lt(receipts.invoiceDate, next)];
  if (status) conds.push(eq(receipts.status, status));

  const rows = await getDb()
    .select()
    .from(receipts)
    .leftJoin(categories, eq(receipts.categoryId, categories.id))
    .where(and(...conds))
    .orderBy(desc(receipts.invoiceDate));

  const summary = summarizeReceipts(
    rows.map((r) => ({
      categoryId: r.receipts.categoryId,
      amount: r.receipts.amount,
      deductibility: r.receipts.deductibility,
    })),
  );

  const catNames = new Map<string, string>();
  for (const r of rows) if (r.categories) catNames.set(r.categories.id, r.categories.name);

  return (
    <>
      <h1>單據列表</h1>

      <form method="get" style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          月份
          <input type="month" name="month" defaultValue={month} style={{ padding: "0.4rem" }} />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          狀態
          <select name="status" defaultValue={status ?? ""} style={{ padding: "0.4rem" }}>
            <option value="">全部</option>
            {RECEIPT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={{ padding: "0.45rem 1rem" }}>
          篩選
        </button>
      </form>

      <section
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          padding: "0.75rem 1rem",
          background: "#f7f7f7",
          borderRadius: 8,
          marginBottom: "1rem",
        }}
      >
        <div>
          <div style={{ color: "#666", fontSize: "0.85rem" }}>筆數</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 600 }}>{summary.count}</div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: "0.85rem" }}>總額</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 600 }}>{formatCents(summary.totalCents)}</div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: "0.85rem" }}>可扣抵進項</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 600 }}>{formatCents(summary.deductibleCents)}</div>
        </div>
      </section>

      {summary.byCategory.length > 0 ? (
        <details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer" }}>分類小計</summary>
          <ul style={{ margin: "0.5rem 0" }}>
            {summary.byCategory.map((c) => (
              <li key={c.categoryId ?? "__none__"}>
                {c.categoryId ? catNames.get(c.categoryId) ?? "(未知分類)" : "未分類"}:{" "}
                {formatCents(c.totalCents)}({c.count} 筆)
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {rows.length === 0 ? (
        <p style={{ color: "#666" }}>
          這個月份沒有單據。<Link href="/receipts/new">去上傳</Link>
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={cell}>日期</th>
                <th style={cell}>賣方</th>
                <th style={{ ...cell, textAlign: "right" }}>金額</th>
                <th style={cell}>分類</th>
                <th style={cell}>扣抵</th>
                <th style={cell}>狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rec = r.receipts;
                return (
                  <tr key={rec.id}>
                    <td style={cell}>
                      <Link href={`/receipts/${rec.id}`}>{rec.invoiceDate}</Link>
                    </td>
                    <td style={cell}>{rec.sellerName ?? rec.sellerTaxId ?? "—"}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{formatCents(amountToCents(rec.amount))}</td>
                    <td style={cell}>{r.categories?.name ?? "未分類"}</td>
                    <td style={cell}>{rec.deductibility ? DEDUCTIBILITY_LABELS[rec.deductibility] : "—"}</td>
                    <td style={cell}>{STATUS_LABELS[rec.status]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
