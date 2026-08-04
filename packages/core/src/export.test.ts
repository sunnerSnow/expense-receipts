import { describe, expect, it } from "vitest";
import {
  buildExportRows,
  EXPORT_COLUMNS,
  exportFileName,
  toCsv,
  type ReceiptForExport,
} from "./export";

function rec(over: Partial<ReceiptForExport> = {}): ReceiptForExport {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    invoiceDate: "2026-07-10",
    docType: "triplicate",
    invoiceNumber: "AB12345678",
    sellerName: "大安文具行",
    sellerTaxId: "12345675",
    buyerTaxId: "53212539",
    currency: "TWD",
    amount: "1103.00",
    taxAmount: "53.00",
    deductibility: "deductible",
    categoryName: "文具用品",
    uploaderName: "Yuki",
    note: "辦公文具",
    imagePath: "/uploads/abc.jpg",
    ...over,
  };
}

/** 把 CSV 拆成欄位陣列(測試用,不處理引號內換行) */
function parseCsv(csv: string): string[][] {
  return csv
    .replace(/^﻿/, "")
    .trimEnd()
    .split("\r\n")
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else if (ch === '"') quoted = false;
          else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      out.push(cur);
      return out;
    });
}

describe("buildExportRows", () => {
  it("空清單", () => {
    expect(buildExportRows([])).toEqual({ rows: [], currencyTotals: {}, count: 0 });
  });

  it("依日期排序並給三位數流水號", () => {
    const b = buildExportRows([
      rec({ id: "c", invoiceDate: "2026-07-20", invoiceNumber: "CC00000003" }),
      rec({ id: "a", invoiceDate: "2026-07-01", invoiceNumber: "AA00000001" }),
      rec({ id: "b", invoiceDate: "2026-07-10", invoiceNumber: "BB00000002" }),
    ]);
    expect(b.rows.map((r) => r.seq)).toEqual(["001", "002", "003"]);
    expect(b.rows.map((r) => r.invoiceDate)).toEqual(["2026-07-01", "2026-07-10", "2026-07-20"]);
  });

  it("同日期時依發票號碼再依 id,排序穩定(重跑編號一致)", () => {
    const input = [
      rec({ id: "z", invoiceNumber: "AA00000002" }),
      rec({ id: "a", invoiceNumber: "AA00000001" }),
    ];
    expect(buildExportRows(input).rows.map((r) => r.invoiceNumber)).toEqual([
      "AA00000001",
      "AA00000002",
    ]);
    // 輸入順序顛倒也得到同樣結果
    expect(buildExportRows([...input].reverse()).rows.map((r) => r.invoiceNumber)).toEqual([
      "AA00000001",
      "AA00000002",
    ]);
  });

  it("影像檔名以流水號開頭,方便對照清單", () => {
    const b = buildExportRows([rec({ imagePath: "/uploads/x.png" })]);
    expect(b.rows[0]?.imageFileName).toBe("001_AB12345678.png");
  });

  it("沒有發票號碼時用賣方名稱當檔名,沒影像則檔名留空", () => {
    expect(
      buildExportRows([rec({ invoiceNumber: null, sellerName: "7-11 忠孝門市" })])[
        "rows"
      ][0]?.imageFileName,
    ).toBe("001_7-11_忠孝門市.jpg");
    expect(buildExportRows([rec({ imagePath: null })]).rows[0]?.imageFileName).toBe("");
  });

  it("檔名去掉路徑與非法字元", () => {
    const b = buildExportRows([rec({ invoiceNumber: null, sellerName: 'a/b\\c:d*e?f"g<h>i|j' })]);
    expect(b.rows[0]?.imageFileName).toBe("001_abcdefghij.jpg");
  });

  it("null 欄位轉空字串,未分類有預設文字", () => {
    const r = buildExportRows([
      rec({ sellerName: null, sellerTaxId: null, buyerTaxId: null, taxAmount: null, categoryName: null, note: null, deductibility: null }),
    ]).rows[0];
    expect(r).toMatchObject({
      sellerName: "",
      sellerTaxId: "",
      buyerTaxId: "",
      taxAmount: "",
      categoryName: "未分類",
      note: "",
      deductibilityLabel: "",
    });
  });

  it("標籤轉成中文", () => {
    const b = buildExportRows([rec({ docType: "foreign", deductibility: "expense_only" })]);
    expect(b.rows[0]?.docTypeLabel).toBe("國外單據");
    expect(b.rows[0]?.deductibilityLabel).toBe("僅費用憑證");
  });
});

describe("buildExportRows — 各幣別小計(不換算)", () => {
  it("外幣與台幣分開小計,台幣排最前", () => {
    const b = buildExportRows([
      rec({ id: "1", currency: "THB", amount: "340.00" }),
      rec({ id: "2", currency: "TWD", amount: "1000.00" }),
      rec({ id: "3", currency: "THB", amount: "121.00" }),
      rec({ id: "4", currency: "JPY", amount: "500.00" }),
    ]);
    expect(b.currencyTotals).toEqual({ TWD: "1000.00", JPY: "500.00", THB: "461.00" });
    expect(Object.keys(b.currencyTotals)[0]).toBe("TWD");
  });

  it("幣別大小寫正規化,空字串視為台幣", () => {
    const b = buildExportRows([rec({ currency: "thb" }), rec({ id: "2", currency: "" })]);
    expect(Object.keys(b.currencyTotals).sort()).toEqual(["THB", "TWD"]);
  });

  it("小計用字串保留兩位小數,不出現浮點誤差", () => {
    const b = buildExportRows([
      rec({ id: "1", amount: "0.10" }),
      rec({ id: "2", amount: "0.20" }),
    ]);
    expect(b.currencyTotals.TWD).toBe("0.30");
  });
});

describe("toCsv", () => {
  it("開頭有 UTF-8 BOM,換行是 CRLF(Excel 相容)", () => {
    const csv = toCsv(buildExportRows([rec()]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("標題列與 EXPORT_COLUMNS 一致", () => {
    expect(parseCsv(toCsv(buildExportRows([])))[0]).toEqual([...EXPORT_COLUMNS]);
  });

  it("逐列輸出單據,欄位數與標題相同", () => {
    const rows = parseCsv(toCsv(buildExportRows([rec(), rec({ id: "2" })])));
    expect(rows).toHaveLength(1 + 2 + 1); // 標題 + 2 筆 + 1 個幣別小計
    expect(rows[1]).toHaveLength(EXPORT_COLUMNS.length);
    expect(rows[1]?.[1]).toBe("2026-07-10");
    expect(rows[1]?.[4]).toBe("大安文具行");
  });

  it("含逗號、引號、換行的欄位會被正確逃逸且原樣還原", () => {
    const note = 'a,b "c" d\ne';
    const csv = toCsv(buildExportRows([rec({ note })]));
    expect(csv).toContain('"a,b ""c"" d'); // 引號成對加倍、整欄包引號
    const row = parseCsv(csv)[1];
    expect(row?.[13]).toBe(note); // 解析回來與原值完全一致
    expect(row).toHaveLength(EXPORT_COLUMNS.length); // 欄位數沒被逗號/換行破壞
  });

  it("防 Excel 公式注入:前導 = + - @ 加單引號", () => {
    const csv = toCsv(buildExportRows([rec({ sellerName: "=1+1" })]));
    expect(parseCsv(csv)[1]?.[4]).toBe("'=1+1");
  });

  it("尾端每個幣別一列小計,金額落在「金額」欄位", () => {
    const csv = toCsv(
      buildExportRows([rec({ amount: "1000.00" }), rec({ id: "2", currency: "THB", amount: "340.00" })]),
    );
    const rows = parseCsv(csv);
    const subtotals = rows.filter((r) => r[0] === "小計");
    expect(subtotals).toHaveLength(2);
    expect(subtotals[0]?.[7]).toBe("TWD");
    expect(subtotals[0]?.[8]).toBe("1000.00");
    expect(subtotals[1]?.[7]).toBe("THB");
    expect(subtotals[1]?.[8]).toBe("340.00");
  });
});

describe("exportFileName", () => {
  it("月份補零", () => {
    expect(exportFileName(2026, 7, "csv")).toBe("報帳清單_2026-07.csv");
    expect(exportFileName(2026, 12, "csv")).toBe("報帳清單_2026-12.csv");
  });

  it("zip 用憑證命名", () => {
    expect(exportFileName(2026, 7, "zip")).toBe("報帳憑證_2026-07.zip");
  });
});
