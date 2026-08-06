import Link from "next/link";
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { exportBatches, receipts, users } from "@expense-receipts/db";
import { formatAmount, summarizeReceipts } from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import { ExportForm } from "./ExportForm";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: string; next: string } {
  const [y, m] = month.split("-").map(Number);
  const year = y ?? new Date().getFullYear();
  const mon = m ?? 1;
  return {
    start: `${month}-01`,
    next: mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`,
  };
}

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();

  /**
   * 有「已確認、未匯出」單據的月份。
   *
   * 報帳的節奏是事後補上個月的單據,所以預設當月常常是 0 筆 —— 使用者會以為
   * 匯出功能壞了。列出真正可匯出的月份,並用它挑預設值。
   */
  const exportableMonths = await db
    .select({
      month: sql<string>`to_char(${receipts.invoiceDate}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    })
    .from(receipts)
    .where(
      and(
        eq(receipts.status, "confirmed"),
        isNull(receipts.exportBatchId),
        isNotNull(receipts.invoiceDate),
      ),
    )
    .groupBy(sql`to_char(${receipts.invoiceDate}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${receipts.invoiceDate}, 'YYYY-MM')`));

  const requested = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;
  const defaultMonth = exportableMonths.some((m) => m.month === currentMonth())
    ? currentMonth()
    : (exportableMonths[0]?.month ?? currentMonth());
  const month = requested ?? defaultMonth;
  const autoSwitched = requested === null && month !== currentMonth();
  const { start, next } = monthBounds(month);

  // 預覽:這個月「已確認且尚未匯出」的單據 —— 就是按下匯出會被帶走的那些
  const pending = await db
    .select({
      amount: receipts.amount,
      currency: receipts.currency,
      categoryId: receipts.categoryId,
      deductibility: receipts.deductibility,
    })
    .from(receipts)
    .where(
      and(
        eq(receipts.status, "confirmed"),
        isNull(receipts.exportBatchId),
        gte(receipts.invoiceDate, start),
        lt(receipts.invoiceDate, next),
      ),
    );

  const summary = summarizeReceipts(pending);

  // 這個月還沒確認的筆數:提醒使用者「先去確認,不然這批不會被匯出」
  const unconfirmed = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(
      and(
        eq(receipts.status, "pending_review"),
        gte(receipts.invoiceDate, start),
        lt(receipts.invoiceDate, next),
      ),
    );

  const batches = await db
    .select({
      id: exportBatches.id,
      periodYear: exportBatches.periodYear,
      periodMonth: exportBatches.periodMonth,
      receiptCount: exportBatches.receiptCount,
      currencyTotals: exportBatches.currencyTotals,
      filePath: exportBatches.filePath,
      imageZipPath: exportBatches.imageZipPath,
      createdAt: exportBatches.createdAt,
      createdByName: users.name,
    })
    .from(exportBatches)
    .leftJoin(users, eq(exportBatches.createdBy, users.id))
    .orderBy(desc(exportBatches.createdAt));

  return (
    <>
      <h1>月結匯出</h1>
      <p className="muted small">
        匯出會把該月<strong>已確認</strong>的單據產成 CSV 清單 + 憑證影像 zip,並把它們標記為
        <strong>已匯出</strong>。已匯出是終態,之後不可修改或刪除。待確認的單據不會被帶走。
      </p>

      {exportableMonths.length > 0 ? (
        <div className="row small">
          <span className="muted">可匯出的月份</span>
          {exportableMonths.map((m) => (
            <Link
              key={m.month}
              href={`/exports?month=${m.month}`}
              className={m.month === month ? "chip chip-warn" : "chip"}
            >
              <span className="tnum">{m.month}</span>
              <span className="muted tnum">{m.count}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="banner">
          目前沒有任何「已確認且未匯出」的單據。單據要先在明細頁按「確認入帳」才會進入待匯出。
        </p>
      )}

      {autoSwitched ? (
        <p className="small muted">
          {currentMonth()} 沒有可匯出的單據,已自動切到 <strong>{month}</strong>。
        </p>
      ) : null}

      {summary.count > 0 ? (
        <section className="card">
          <div className="stats">
            <div className="stat">
              <span className="stat-label">待匯出筆數</span>
              <span className="stat-value">{summary.count}</span>
            </div>
            {summary.byCurrency.map((c) => (
              <div className="stat" key={c.currency}>
                <span className="stat-label">
                  {c.currency === "TWD" ? "台幣" : c.currency}({c.count} 筆)
                </span>
                <span className="stat-value">
                  {formatAmount((c.totalCents / 100).toFixed(2), c.currency)}
                </span>
              </div>
            ))}
          </div>

          {summary.hasForeignCurrency ? (
            <p className="small muted">
              這批含外幣單據,清單會列原幣金額與幣別,<strong>不換算台幣</strong> ——
              匯率由會計依實際入帳成本決定。
            </p>
          ) : null}
        </section>
      ) : null}

      <details className="card-flat">
        <summary className="small">換一個月份</summary>
        <form method="get" className="row stack-inset">
          <div className="field">
            <label htmlFor="e-month">月份</label>
            <input id="e-month" className="input" type="month" name="month" defaultValue={month} />
          </div>
          <button type="submit" className="btn btn-sm">
            查看
          </button>
        </form>
      </details>

      {unconfirmed.length > 0 ? (
        <p className="banner banner-warn">
          這個月還有 <strong>{unconfirmed.length}</strong> 筆待確認的單據不會被匯出。{" "}
          <Link href={`/receipts?month=${month}&status=pending_review`}>先去確認</Link>
        </p>
      ) : null}

      <ExportForm month={month} count={summary.count} />

      <h2>匯出紀錄</h2>
      {batches.length === 0 ? (
        <p className="muted small">還沒有任何匯出紀錄。</p>
      ) : (
        <div className="list">
          {batches.map((b) => (
            <div className="item" key={b.id}>
              <span className="item-title tnum">
                {b.periodYear}-{String(b.periodMonth).padStart(2, "0")}
              </span>
              <span className="item-amount">
                {Object.entries(b.currencyTotals ?? {}).map(([cur, total]) => (
                  <span key={cur} className="stack-sm">
                    {formatAmount(total, cur)}
                  </span>
                ))}
              </span>
              <span className="item-meta">
                <span className="chip">{b.receiptCount} 筆</span>
                <span className="tnum">{b.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                <span>{b.createdByName ?? "—"}</span>
                {b.filePath ? <a href={`/exports/${b.id}/download?file=csv`}>下載 CSV</a> : null}
                {b.imageZipPath ? <a href={`/exports/${b.id}/download?file=zip`}>影像 zip</a> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
