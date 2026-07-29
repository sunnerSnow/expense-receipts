import { describe, expect, it } from "vitest";
import { assessDeductibility, canTransitionStatus } from "./receipt";

const COMPANY = "53212539";

describe("assessDeductibility", () => {
  it("統一發票打對公司統編 → 可扣抵", () => {
    expect(
      assessDeductibility({ docType: "einvoice", buyerTaxId: COMPANY, companyTaxId: COMPANY }),
    ).toBe("deductible");
    expect(
      assessDeductibility({ docType: "triplicate", buyerTaxId: COMPANY, companyTaxId: COMPANY }),
    ).toBe("deductible");
  });

  it("統一發票但買方統編不是本公司 → 需人工確認", () => {
    expect(
      assessDeductibility({ docType: "einvoice", buyerTaxId: "12345678", companyTaxId: COMPANY }),
    ).toBe("review");
  });

  it("未打統編或非統一發票 → 僅費用憑證", () => {
    expect(
      assessDeductibility({ docType: "einvoice", buyerTaxId: null, companyTaxId: COMPANY }),
    ).toBe("expense_only");
    expect(
      assessDeductibility({ docType: "receipt", buyerTaxId: COMPANY, companyTaxId: COMPANY }),
    ).toBe("expense_only");
    expect(
      assessDeductibility({ docType: "foreign", buyerTaxId: null, companyTaxId: COMPANY }),
    ).toBe("expense_only");
  });
});

describe("canTransitionStatus", () => {
  it("允許 pending_review → confirmed → exported", () => {
    expect(canTransitionStatus("pending_review", "confirmed")).toBe(true);
    expect(canTransitionStatus("confirmed", "exported")).toBe(true);
  });

  it("拒絕跳關與回頭", () => {
    expect(canTransitionStatus("pending_review", "exported")).toBe(false);
    expect(canTransitionStatus("confirmed", "pending_review")).toBe(false);
    expect(canTransitionStatus("exported", "confirmed")).toBe(false);
  });
});
