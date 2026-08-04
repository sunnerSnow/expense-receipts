import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
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
      currency: r.receipts.currency,
      deductibility: r.receipts.deductibility,
    })),
  );

  const catNames = new Map<string, string>();
  for (const r of rows) if (r.categories) catNames.set(r.categories.id, r.categories.name);

  /**
   * 「待處理」不受月份篩選限制。
   *
   * 原因:AI 辨識中的單據還沒有日期(invoice_date 是 NULL),沒讀出日期的也一樣 ——
   * 這些單據落在所有月份區間之外,只靠上面那張表會整批消失不見。
   */
  const attention = await getDb()
    .select({
      id: receipts.id,
      recognitionStatus: receipts.recognitionStatus,
      recognitionError: receipts.recognitionError,
      invoiceDate: receipts.invoiceDate,
      sellerName: receipts.sellerName,
      amount: receipts.amount,
    })
    .from(receipts)
    .where(
      and(
        eq(receipts.status, "pending_review"),
        or(inArray(receipts.recognitionStatus, ["queued", "failed"]), isNull(receipts.invoiceDate)),
      ),
    )
    .orderBy(desc(receipts.createdAt));

  return (
    <>
      <h1>單據列表</h1>

      {attention.length > 0 ? (
        <section
          style={{
            padding: "0.75rem 1rem",
            background: "#fff8e1",
            border: "1px solid #ecd08a",
            borderRadius: 8,
            marginBottom: "1rem",
          }}
        >
          <strong>待處理({attention.length})</strong>
          <p style={{ margin: "0.25rem 0 0.5rem", color: "#666", fontSize: "0.9rem" }}>
            辨識中或缺日期的單據不屬於任何月份,列在這裡直到補齊資料並確認入帳。
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {attention.map((a) => (
              <li key={a.id}>
                <Link href={`/receipts/${a.id}`}>
                  {a.sellerName ?? "(未辨識)"}
                  {a.invoiceDate ? `　${a.invoiceDate}` : ""}
                </Link>
                {a.recognitionStatus === "queued"
                  ? "　🤖 辨識中…"
                  : a.recognitionStatus === "failed"
                    ? `　⚠️ 辨識失敗:${a.recognitionError ?? "原因未知"}`
                    : "　⚠️ 缺日期"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
          <div style={{ color: "#666", fontSize: "0.85rem" }}>
            總額{summary.hasForeignCurrency ? "(台幣部分)" : ""}
          </div>
          <div style={{ fontSize: "1.3rem", fontWeight: 600 }}>{formatCents(summary.totalCents)}</div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: "0.85rem" }}>可扣抵進項</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 600 }}>{formatCents(summary.deductibleCents)}</div>
        </div>
        {/* 外幣不併入台幣總額(340 泰銖不是 340 台幣),各幣別分開列 */}
        {summary.byCurrency
          .filter((c) => c.currency !== "TWD")
          .map((c) => (
            <div key={c.currency}>
              <div style={{ color: "#666", fontSize: "0.85rem" }}>{c.currency}({c.count} 筆)</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 600 }}>
                {c.currency} {(c.totalCents / 100).toLocaleString()}
              </div>
            </div>
          ))}
      </section>

      {summary.hasForeignCurrency ? (
        <p style={{ color: "#b8860b", marginTop: "-0.5rem" }}>
          本月有外幣單據,金額為原幣未換算;台幣總額與分類小計不含外幣,報帳時請自行換算。
        </p>
      ) : null}

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
                    <td style={{ ...cell, textAlign: "right" }}>
                      {/* 外幣不能掛 NT$ 前綴,標出實際幣別 */}
                      {rec.currency === "TWD"
                        ? formatCents(amountToCents(rec.amount))
                        : `${rec.currency} ${Number(rec.amount).toLocaleString()}`}
                    </td>
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
