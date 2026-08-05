import Link from "next/link";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { categories, receipts } from "@expense-receipts/db";
import {
  formatAmount,
  formatCents,
  summarizeReceipts,
  RECEIPT_STATUSES,
  type ReceiptStatus,
} from "@expense-receipts/core";
import { getDb } from "@/lib/db";
import {
  DEDUCTIBILITY_CHIP,
  DEDUCTIBILITY_LABELS,
  STATUS_CHIP,
  STATUS_LABELS,
} from "@/lib/labels";

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

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const db = getDb();

  /**
   * 有單據的月份。
   *
   * 為什麼需要:報帳的實際節奏是「事後補上個月的單據」(出差回來才整理),
   * 所以預設顯示當月常常是空的 —— 使用者會以為資料不見了。有了這份清單就能
   * 一是挑出合理的預設月份,二是在畫面上直接給快速切換的連結。
   */
  const monthsWithData = await db
    .select({
      month: sql<string>`to_char(${receipts.invoiceDate}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    })
    .from(receipts)
    .where(isNotNull(receipts.invoiceDate))
    .groupBy(sql`to_char(${receipts.invoiceDate}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${receipts.invoiceDate}, 'YYYY-MM')`));

  const requested = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;
  // 沒指定月份時:當月有資料就用當月,否則退到最近一個有資料的月份
  const defaultMonth = monthsWithData.some((m) => m.month === currentMonth())
    ? currentMonth()
    : (monthsWithData[0]?.month ?? currentMonth());
  const month = requested ?? defaultMonth;
  const autoSwitched = requested === null && month !== currentMonth();
  const { start, next } = monthBounds(month);

  const conds = [gte(receipts.invoiceDate, start), lt(receipts.invoiceDate, next)];
  if (status) conds.push(eq(receipts.status, status));

  const rows = await db
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
  const attention = await db
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
      <div className="row-between">
        <h1>單據列表</h1>
        <span className="muted small tnum">{month}</span>
      </div>

      {/*
        待處理不受月份限制:辨識中或缺日期的單據不屬於任何月份,
        放在最上面才不會整批消失(這是實際踩過的坑)。
      */}
      {attention.length > 0 ? (
        <section className="banner banner-warn">
          <strong>待處理({attention.length})</strong>
          <span className="small">辨識中或缺日期的單據不屬於任何月份,補齊資料並確認入帳後就會離開這裡。</span>
          <div className="list">
            {attention.map((a) => (
              <Link key={a.id} href={`/receipts/${a.id}`} className="item">
                <span className="item-title">{a.sellerName ?? "(尚未辨識)"}</span>
                <span className="item-amount tnum">{a.invoiceDate ?? "—"}</span>
                <span className="item-meta">
                  {a.recognitionStatus === "queued" ? (
                    <span className="chip chip-info">
                      <span className="spinner" aria-hidden="true" /> 辨識中
                    </span>
                  ) : a.recognitionStatus === "failed" ? (
                    <>
                      <span className="chip chip-danger">辨識失敗</span>
                      <span>{a.recognitionError ?? "原因未知"}</span>
                    </>
                  ) : (
                    <span className="chip chip-warn">缺日期</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* 有單據的月份直接列出來:預設當月常常是空的,不給入口會讓人以為資料不見了 */}
      {monthsWithData.length > 0 ? (
        <div className="row small">
          <span className="muted">有單據的月份</span>
          {monthsWithData.map((m) => (
            <Link
              key={m.month}
              href={`/receipts?month=${m.month}`}
              className={m.month === month ? "chip chip-warn" : "chip"}
            >
              <span className="tnum">{m.month}</span>
              <span className="muted tnum">{m.count}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {autoSwitched ? (
        <p className="small muted">
          {currentMonth()} 沒有單據,已自動顯示最近有資料的 <strong>{month}</strong>。
        </p>
      ) : null}

      <section className="card">
        {/*
          只顯示有意義的數字:全是外幣的月份不需要看到兩個 NT$0。
          外幣不併入台幣總額(340 泰銖不是 340 台幣),各幣別分開列。
        */}
        <div className="stats">
          <div className="stat">
            <span className="stat-label">筆數</span>
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
          {summary.deductibleCents > 0 ? (
            <div className="stat">
              <span className="stat-label">可扣抵進項</span>
              <span className="stat-value">{formatCents(summary.deductibleCents)}</span>
            </div>
          ) : null}
        </div>

        {summary.hasForeignCurrency ? (
          <p className="small muted">
            外幣金額是單據上的原幣,未換算台幣;可扣抵進項與分類小計只計台幣單據。
          </p>
        ) : null}

        {summary.byCategory.length > 0 ? (
          <details>
            <summary className="small">分類小計</summary>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {summary.byCategory.map((c) => (
                    <tr key={c.categoryId ?? "__none__"}>
                      <td>{c.categoryId ? (catNames.get(c.categoryId) ?? "(未知分類)") : "未分類"}</td>
                      <td className="num muted">{c.count} 筆</td>
                      <td className="num">{formatCents(c.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      {/* 月份切換已有上面的 chip,精確篩選收進 details 免得占掉半個螢幕 */}
      <details className="card-flat">
        <summary className="small">
          進階篩選{status ? `:${STATUS_LABELS[status]}` : ""}
        </summary>
        <form method="get" className="stack stack-inset">
          <div className="grid-2">
            <div className="field">
              <label htmlFor="f-month">月份</label>
              <input id="f-month" className="input" type="month" name="month" defaultValue={month} />
            </div>
            <div className="field">
              <label htmlFor="f-status">狀態</label>
              <select id="f-status" className="select" name="status" defaultValue={status ?? ""}>
                <option value="">全部</option>
                {RECEIPT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-sm">
            套用
          </button>
        </form>
      </details>

      {rows.length === 0 ? (
        <div className="empty">
          <p>{month} 沒有單據。</p>
          <Link href="/receipts/new" className="btn btn-primary">
            ＋ 上傳單據
          </Link>
        </div>
      ) : (
        <div className="list">
          {rows.map((r) => {
            const rec = r.receipts;
            return (
              <Link key={rec.id} href={`/receipts/${rec.id}`} className="item">
                <span className="item-title">{rec.sellerName ?? rec.sellerTaxId ?? "(未填賣方)"}</span>
                <span className="item-amount">{formatAmount(rec.amount, rec.currency)}</span>
                <span className="item-meta">
                  <span className="tnum">{rec.invoiceDate}</span>
                  <span className={STATUS_CHIP[rec.status]}>{STATUS_LABELS[rec.status]}</span>
                  <span className="chip">{r.categories?.name ?? "未分類"}</span>
                  {rec.deductibility ? (
                    <span className={DEDUCTIBILITY_CHIP[rec.deductibility]}>
                      {DEDUCTIBILITY_LABELS[rec.deductibility]}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
