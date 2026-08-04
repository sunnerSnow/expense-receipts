import { describe, expect, it } from "vitest";
import {
  buildRecognitionJsonSchema,
  buildRecognitionPrompt,
  normalizeRecognition,
  type RawRecognition,
} from "./recognition";

const COMPANY = "53212539";
const OPTIONS = { categoryCodes: ["travel", "meal", "misc"], companyTaxId: COMPANY };

/** 一份「模型完美讀出」的三聯式發票回傳,測試時只覆寫要驗的欄位 */
function raw(overrides: Partial<RawRecognition> = {}): RawRecognition {
  return {
    docType: "triplicate",
    invoiceNumber: "AB12345678",
    invoiceDate: "2026-03-08",
    sellerName: "測試文具行",
    sellerTaxId: "12345675",
    buyerTaxId: COMPANY,
    currency: "TWD",
    amount: "1050",
    taxAmount: "50",
    categoryCode: "misc",
    summary: "辦公文具採購",
    ...overrides,
  };
}

function ok(input: unknown) {
  const r = normalizeRecognition(input, OPTIONS);
  if (!r.ok) throw new Error(`預期成功但失敗:${r.error}`);
  return r.value;
}

describe("normalizeRecognition — 正常路徑", () => {
  it("完整讀出的三聯式發票沒有 warning,且判定可扣抵", () => {
    const v = ok(raw());
    expect(v).toMatchObject({
      docType: "triplicate",
      invoiceNumber: "AB12345678",
      invoiceDate: "2026-03-08",
      sellerTaxId: "12345675",
      buyerTaxId: COMPANY,
      currency: "TWD",
      amount: "1050.00",
      taxAmount: "50.00",
      categoryCode: "misc",
      deductibility: "deductible",
      summary: "辦公文具採購",
    });
    expect(v.warnings).toEqual([]);
  });

  it("金額固定補成兩位小數", () => {
    expect(ok(raw({ amount: "80" })).amount).toBe("80.00");
    expect(ok(raw({ amount: "1234.5" })).amount).toBe("1234.50");
  });

  it("容忍模型帶進千分位與貨幣符號", () => {
    expect(ok(raw({ amount: "NT$1,050", taxAmount: "" })).amount).toBe("1050.00");
  });
});

describe("normalizeRecognition — 失敗(交還人工)", () => {
  it("回傳不是物件", () => {
    expect(normalizeRecognition("nope", OPTIONS)).toEqual({ ok: false, error: "辨識結果不是物件" });
    expect(normalizeRecognition(null, OPTIONS).ok).toBe(false);
    expect(normalizeRecognition([], OPTIONS).ok).toBe(false);
  });

  it("金額讀不出來就失敗,不塞 0 進帳", () => {
    for (const amount of ["", "看不清", "-100", "1050.999"]) {
      const r = normalizeRecognition(raw({ amount }), OPTIONS);
      expect(r.ok, `amount=${amount}`).toBe(false);
    }
  });
});

describe("normalizeRecognition — 日期", () => {
  it("民國年轉西元", () => {
    expect(ok(raw({ invoiceDate: "115-03-08" })).invoiceDate).toBe("2026-03-08");
    expect(ok(raw({ invoiceDate: "1150308" })).invoiceDate).toBe("2026-03-08");
    expect(ok(raw({ invoiceDate: "115/3/8" })).invoiceDate).toBe("2026-03-08");
  });

  it("西元年原樣保留,並接受斜線與點分隔", () => {
    expect(ok(raw({ invoiceDate: "2026/03/08" })).invoiceDate).toBe("2026-03-08");
    expect(ok(raw({ invoiceDate: "2026.03.08" })).invoiceDate).toBe("2026-03-08");
    expect(ok(raw({ invoiceDate: "20260308" })).invoiceDate).toBe("2026-03-08");
  });

  it("不存在的日期與空白視為未讀出,留 null + warning", () => {
    for (const d of ["", "2026-02-31", "2026-13-01", "看不清"]) {
      const v = ok(raw({ invoiceDate: d }));
      expect(v.invoiceDate, `date=${d}`).toBeNull();
      expect(v.warnings).toContain("日期未讀出,請補填");
    }
  });
});

describe("normalizeRecognition — 統編與扣抵", () => {
  it("買方統編是本公司 → deductible", () => {
    expect(ok(raw()).deductibility).toBe("deductible");
  });

  it("買方統編是別人的 → review + 提醒打錯統編", () => {
    const v = ok(raw({ buyerTaxId: "99999999" }));
    expect(v.deductibility).toBe("review");
    expect(v.warnings.some((w) => w.includes("不是本公司統編"))).toBe(true);
  });

  it("收據(非統一發票)即使打了公司統編也只是費用憑證", () => {
    expect(ok(raw({ docType: "receipt", invoiceNumber: "" })).deductibility).toBe("expense_only");
  });

  it("統編不是 8 碼就略去並警告", () => {
    const v = ok(raw({ sellerTaxId: "1234", buyerTaxId: "" }));
    expect(v.sellerTaxId).toBeNull();
    expect(v.buyerTaxId).toBeNull();
    expect(v.deductibility).toBe("expense_only");
    expect(v.warnings.some((w) => w.includes("賣方統編不是 8 碼"))).toBe(true);
  });

  it("統編帶連字號或空白會被清掉", () => {
    expect(ok(raw({ sellerTaxId: "123-456 75" })).sellerTaxId).toBe("12345675");
  });
});

describe("normalizeRecognition — 發票號碼", () => {
  it("轉大寫並去掉連字號", () => {
    expect(ok(raw({ invoiceNumber: "ab-1234 5678" })).invoiceNumber).toBe("AB12345678");
  });

  it("台灣發票號碼格式不對就略去並警告", () => {
    const v = ok(raw({ invoiceNumber: "A1234567" }));
    expect(v.invoiceNumber).toBeNull();
    expect(v.warnings.some((w) => w.includes("單據號碼格式不正確"))).toBe(true);
  });

  it("統一發票卻沒讀到號碼會提醒(去重與扣抵靠它)", () => {
    const v = ok(raw({ invoiceNumber: "" }));
    expect(v.warnings.some((w) => w.includes("未讀出發票號碼"))).toBe(true);
  });

  it("收據沒有發票號碼是正常的,不警告", () => {
    const v = ok(raw({ docType: "receipt", invoiceNumber: "", taxAmount: "" }));
    expect(v.warnings.some((w) => w.includes("發票號碼"))).toBe(false);
  });
});

describe("normalizeRecognition — 稅額比例檢查", () => {
  it("稅額約為未稅額的 5% 時不警告", () => {
    expect(ok(raw({ amount: "1050", taxAmount: "50" })).warnings).toEqual([]);
    expect(ok(raw({ amount: "1049", taxAmount: "50" })).warnings).toEqual([]);
  });

  it("發票稅額進位不算異常(1050 未稅 → 稅 53、總計 1103)", () => {
    // 1050 × 5% = 52.5,發票上進位成 53,總計 1103。
    // 若用「含稅 ≈ 稅額 × 21」反推會算出 1113、誤判 10 元誤差。
    expect(ok(raw({ amount: "1103", taxAmount: "53" })).warnings).toEqual([]);
    expect(ok(raw({ amount: "1102", taxAmount: "52" })).warnings).toEqual([]);
    expect(ok(raw({ amount: "21", taxAmount: "1" })).warnings).toEqual([]);
  });

  it("比例明顯不符就警告(可能其中一個讀錯)", () => {
    const v = ok(raw({ amount: "1050", taxAmount: "500" }));
    expect(v.warnings.some((w) => w.includes("不符 5% 營業稅比例"))).toBe(true);
  });

  it("稅額不小於總額必定是讀錯", () => {
    const v = ok(raw({ amount: "50", taxAmount: "50" }));
    expect(v.warnings.some((w) => w.includes("不小於總額"))).toBe(true);
  });

  it("非統一發票不做比例檢查(收據沒有稅額結構)", () => {
    const v = ok(raw({ docType: "receipt", invoiceNumber: "", amount: "1050", taxAmount: "500" }));
    expect(v.warnings.some((w) => w.includes("營業稅比例"))).toBe(false);
  });
});

describe("normalizeRecognition — 國外單據(海外出差)", () => {
  /** 泰國 Starbucks:總額 340 THB、VAT 22.24、未稅 317.76(VAT 7%) */
  const thaiStarbucks = () =>
    raw({
      docType: "foreign",
      currency: "THB",
      amount: "340",
      taxAmount: "22.24",
      invoiceNumber: "260705-02-10267",
      sellerTaxId: "0105541006668",
      buyerTaxId: "",
      sellerName: "Starbucks Coffee",
      invoiceDate: "2026-07-05",
    });

  it("泰國 7% VAT 不會被台灣 5% 的檢查誤判", () => {
    const v = ok(thaiStarbucks());
    expect(v.warnings.some((w) => w.includes("5% 營業稅比例"))).toBe(false);
    expect(v.taxAmount).toBe("22.24");
  });

  it("金額保留原幣、幣別保留 THB,並提醒需換算", () => {
    const v = ok(thaiStarbucks());
    expect(v.currency).toBe("THB");
    expect(v.amount).toBe("340.00");
    expect(v.warnings.some((w) => w.includes("外幣單據") && w.includes("THB"))).toBe(true);
  });

  it("13 碼泰國統編照收,不因為不是 8 碼就被丟掉", () => {
    expect(ok(thaiStarbucks()).sellerTaxId).toBe("0105541006668");
  });

  it("自由格式的國外單據號碼照收(仍吃唯一索引可擋重複上傳)", () => {
    expect(ok(thaiStarbucks()).invoiceNumber).toBe("260705-02-10267");
    expect(ok(raw({ docType: "foreign", currency: "THB", invoiceNumber: "501083100023776" })).invoiceNumber).toBe(
      "501083100023776",
    );
  });

  it("國外單據只作費用憑證,不可扣抵台灣進項稅", () => {
    expect(ok(thaiStarbucks()).deductibility).toBe("expense_only");
  });

  it("國外單據不檢查「買方統編是否為本公司」", () => {
    const v = ok(raw({ docType: "foreign", currency: "THB", buyerTaxId: "0105526048623" }));
    expect(v.warnings.some((w) => w.includes("不是本公司統編"))).toBe(false);
  });

  it("台幣單據仍走台灣規則(8 碼統編、發票號碼格式)", () => {
    const v = ok(raw({ sellerTaxId: "0105541006668" }));
    expect(v.sellerTaxId).toBeNull();
    expect(v.warnings.some((w) => w.includes("不是 8 碼數字"))).toBe(true);
  });

  it("稅額不小於總額的檢查不分國內外", () => {
    const v = ok(raw({ docType: "foreign", currency: "THB", amount: "50", taxAmount: "50" }));
    expect(v.warnings.some((w) => w.includes("不小於總額"))).toBe(true);
  });
});

describe("normalizeRecognition — 分類、幣別、單據類型", () => {
  it("分類不在清單內就留空並提醒", () => {
    for (const code of ["", "not_a_code"]) {
      const v = ok(raw({ categoryCode: code }));
      expect(v.categoryCode, `code=${code}`).toBeNull();
      expect(v.warnings).toContain("分類未能判斷,請手動選擇");
    }
  });

  it("幣別轉大寫;非三碼視為 TWD", () => {
    expect(ok(raw({ currency: "usd" })).currency).toBe("USD");
    const v = ok(raw({ currency: "新台幣" }));
    expect(v.currency).toBe("TWD");
    expect(v.warnings.some((w) => w.includes("無法辨識"))).toBe(true);
  });

  it("未知單據類型歸為 other 並警告", () => {
    const v = ok(raw({ docType: "invoice_maybe" }));
    expect(v.docType).toBe("other");
    expect(v.warnings.some((w) => w.includes("單據類型無法判斷"))).toBe(true);
  });

  it("模型說是電子發票時必定提醒核對(代表 QR 沒解出來)", () => {
    const v = ok(raw({ docType: "einvoice" }));
    expect(v.warnings.some((w) => w.includes("條碼未能解讀"))).toBe(true);
  });
});

describe("buildRecognitionJsonSchema", () => {
  it("所有欄位都是 required 的字串(讀不到用空字串表達)", () => {
    const schema = buildRecognitionJsonSchema(["travel"]) as {
      properties: Record<string, { type: string; enum?: string[] }>;
      required: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual(schema.required.slice().sort());
    for (const [key, prop] of Object.entries(schema.properties)) {
      expect(prop.type, key).toBe("string");
    }
  });

  it("分類 enum 含空字串,讓模型能表達「判斷不出來」", () => {
    const schema = buildRecognitionJsonSchema(["travel", "meal"]) as {
      properties: { categoryCode: { enum: string[] } };
    };
    expect(schema.properties.categoryCode.enum).toEqual(["travel", "meal", ""]);
  });

  it("單據類型 enum 與 core 的 RECEIPT_DOC_TYPES 一致", () => {
    const schema = buildRecognitionJsonSchema([]) as {
      properties: { docType: { enum: string[] } };
    };
    expect(schema.properties.docType.enum).toContain("einvoice");
    expect(schema.properties.docType.enum).toContain("other");
  });
});

describe("normalizeRecognition — 沒有設定公司統編", () => {
  const NO_COMPANY = { categoryCodes: OPTIONS.categoryCodes, companyTaxId: null };

  function okNoCompany(input: unknown) {
    const r = normalizeRecognition(input, NO_COMPANY);
    if (!r.ok) throw new Error(`預期成功但失敗:${r.error}`);
    return r.value;
  }

  it("不再抱怨「買方統編不是本公司統編」", () => {
    const v = okNoCompany(raw({ buyerTaxId: "12345678" }));
    expect(v.warnings.some((w) => w.includes("不是本公司統編"))).toBe(false);
  });

  it("有買方統編的統一發票落在 review,交人工判斷", () => {
    expect(okNoCompany(raw({ buyerTaxId: "12345678" })).deductibility).toBe("review");
  });

  it("泰國收據完全不受影響", () => {
    const v = okNoCompany(
      raw({ docType: "foreign", currency: "THB", amount: "340", taxAmount: "22.24", buyerTaxId: "" }),
    );
    expect(v.deductibility).toBe("expense_only");
    expect(v.warnings.some((w) => w.includes("統編"))).toBe(false);
  });
});

describe("buildRecognitionPrompt", () => {
  it("帶入公司統編與分類清單", () => {
    const p = buildRecognitionPrompt({
      categories: [{ code: "travel", name: "交通費" }],
      companyTaxId: COMPANY,
    });
    expect(p).toContain(COMPANY);
    expect(p).toContain("travel:交通費");
    expect(p).toContain("民國");
  });

  it("沒有可用分類時明確要求回空字串", () => {
    const p = buildRecognitionPrompt({ categories: [], companyTaxId: COMPANY });
    expect(p).toContain("categoryCode 一律回空字串");
  });

  it("沒有公司統編時不在提示詞裡編一個出來", () => {
    const p = buildRecognitionPrompt({ categories: [], companyTaxId: null });
    expect(p).not.toContain("本公司統編為");
    expect(p).toContain("買方統編通常印在"); // 仍要求讀出買方統編
  });
});
