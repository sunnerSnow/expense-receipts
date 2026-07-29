import { describe, expect, it } from "vitest";
import { isEInvoiceLeftQr, isEInvoiceRightQr, parseEInvoiceQr } from "./einvoice-qr";

// 表頭:AB12345678 / 民國 115-07-28 / 隨機碼 5926 / 未稅 0x3E8=1000 / 含稅 0x41A=1050
//       買方 00000000(個人) / 賣方 12345678 / 加密驗證 24 碼
const HEADER =
  "AB12345678" + "1150728" + "5926" + "000003e8" + "0000041a" + "00000000" + "12345678" + "x".repeat(24);

const LEFT_WITH_ITEMS = `${HEADER}:**********:3:2:1:咖啡:2:60:三明治:1:55`;

describe("parseEInvoiceQr", () => {
  it("解析表頭固定欄位", () => {
    const result = parseEInvoiceQr(LEFT_WITH_ITEMS);
    expect(result).not.toBeNull();
    expect(result?.invoiceNumber).toBe("AB12345678");
    expect(result?.invoiceDate).toBe("2026-07-28"); // 民國 115 → 西元 2026
    expect(result?.randomCode).toBe("5926");
    expect(result?.salesAmount).toBe(1000);
    expect(result?.totalAmount).toBe(1050);
    expect(result?.sellerTaxId).toBe("12345678");
    expect(result?.encryptedVerification).toBe("x".repeat(24));
  });

  it("買方統編 00000000 視為個人消費(null)", () => {
    expect(parseEInvoiceQr(LEFT_WITH_ITEMS)?.buyerTaxId).toBeNull();
  });

  it("有打統編時回傳買方統編", () => {
    const withBuyer = LEFT_WITH_ITEMS.replace("00000000", "53212539");
    expect(parseEInvoiceQr(withBuyer)?.buyerTaxId).toBe("53212539");
  });

  it("解析左 QR 內的品項與品目總筆數", () => {
    const result = parseEInvoiceQr(LEFT_WITH_ITEMS);
    expect(result?.totalItemCount).toBe(3);
    expect(result?.items).toEqual([
      { name: "咖啡", quantity: 2, unitPrice: 60 },
      { name: "三明治", quantity: 1, unitPrice: 55 },
    ]);
  });

  it("合併右 QR 的接續品項", () => {
    const result = parseEInvoiceQr(LEFT_WITH_ITEMS, "**紅茶:1:25");
    expect(result?.items).toHaveLength(3);
    expect(result?.items[2]).toEqual({ name: "紅茶", quantity: 1, unitPrice: 25 });
  });

  it("只有表頭(無品項區)也能解析", () => {
    const result = parseEInvoiceQr(HEADER);
    expect(result).not.toBeNull();
    expect(result?.items).toEqual([]);
    expect(result?.totalItemCount).toBeNull();
  });

  it("非電子發票 QR 回傳 null", () => {
    expect(parseEInvoiceQr("https://example.com/some-random-qr")).toBeNull();
    expect(parseEInvoiceQr("")).toBeNull();
    expect(parseEInvoiceQr("ab12345678" + "1150728" + HEADER.slice(17))).toBeNull(); // 字軌須大寫
  });

  it("金額欄位非 16 進位時回傳 null", () => {
    const bad = HEADER.replace("000003e8", "0000zzzz");
    expect(parseEInvoiceQr(bad)).toBeNull();
  });
});

describe("isEInvoiceLeftQr / isEInvoiceRightQr", () => {
  it("辨別左右 QR", () => {
    expect(isEInvoiceLeftQr(LEFT_WITH_ITEMS)).toBe(true);
    expect(isEInvoiceLeftQr("**紅茶:1:25")).toBe(false);
    expect(isEInvoiceRightQr("**紅茶:1:25")).toBe(true);
    expect(isEInvoiceRightQr(LEFT_WITH_ITEMS)).toBe(false);
  });
});
