import { describe, expect, it } from "vitest";
import {
  CAPTURE_MAX_IMAGE_BYTES,
  checkRelayUpload,
  classifyUploadResponse,
  isUploadId,
  parseRelayUploadMeta,
  RELAY_CREDENTIAL_REFRESH_AFTER_MS,
  RELAY_NOTE_MAX_LENGTH,
  shouldRefreshRelayCredential,
} from "./relay";

const ID = "3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";

describe("isUploadId", () => {
  it("接受 UUID(大小寫皆可)", () => {
    expect(isUploadId(ID)).toBe(true);
    expect(isUploadId(ID.toUpperCase())).toBe(true);
  });

  it("拒絕其他字串 —— 它會被拿去當 KV key 與單據主鍵", () => {
    expect(isUploadId("")).toBe(false);
    expect(isUploadId("not-a-uuid")).toBe(false);
    expect(isUploadId(`${ID}x`)).toBe(false);
    expect(isUploadId(`../${ID}`)).toBe(false);
  });
});

describe("checkRelayUpload", () => {
  const ok = { id: ID, mimeType: "image/jpeg", size: 1234, note: "" };

  it("合格的件通過,空備註正規化成 null", () => {
    expect(checkRelayUpload(ok)).toEqual({ ok: true, note: null });
    expect(checkRelayUpload({ ...ok, note: "   " })).toEqual({ ok: true, note: null });
  });

  it("備註去頭尾空白", () => {
    expect(checkRelayUpload({ ...ok, note: "  客戶 A 晚餐 " })).toEqual({
      ok: true,
      note: "客戶 A 晚餐",
    });
  });

  it("iPhone 的 HEIC 也收", () => {
    expect(checkRelayUpload({ ...ok, mimeType: "image/heic" }).ok).toBe(true);
  });

  it("id 不是 UUID → 400", () => {
    expect(checkRelayUpload({ ...ok, id: "abc" })).toMatchObject({ ok: false, status: 400 });
  });

  it("空檔 → 400、超過上限 → 413(剛好等於上限可以)", () => {
    expect(checkRelayUpload({ ...ok, size: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(checkRelayUpload({ ...ok, size: CAPTURE_MAX_IMAGE_BYTES }).ok).toBe(true);
    expect(checkRelayUpload({ ...ok, size: CAPTURE_MAX_IMAGE_BYTES + 1 })).toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("不是影像 → 415", () => {
    expect(checkRelayUpload({ ...ok, mimeType: "application/pdf" })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(checkRelayUpload({ ...ok, mimeType: "" })).toMatchObject({ ok: false, status: 415 });
  });

  it("備註超過上限 → 400(上限以去空白後計算)", () => {
    const max = "字".repeat(RELAY_NOTE_MAX_LENGTH);
    expect(checkRelayUpload({ ...ok, note: ` ${max} ` }).ok).toBe(true);
    expect(checkRelayUpload({ ...ok, note: `${max}字` })).toMatchObject({ ok: false, status: 400 });
  });

  it("上限內的中文備註,連同其他欄位序列化後放得進 KV metadata(1024 bytes)", () => {
    const meta = {
      uploaderId: ID,
      mimeType: "image/jpeg",
      note: "字".repeat(RELAY_NOTE_MAX_LENGTH),
      receivedAt: Date.now(),
    };
    expect(new TextEncoder().encode(JSON.stringify(meta)).length).toBeLessThanOrEqual(1024);
  });
});

describe("parseRelayUploadMeta", () => {
  const good = { uploaderId: "user-1", mimeType: "image/png", note: "備註", receivedAt: 1 };

  it("形狀正確就原樣帶回", () => {
    expect(parseRelayUploadMeta(good)).toEqual(good);
    expect(parseRelayUploadMeta({ ...good, note: null })).toEqual({ ...good, note: null });
  });

  it("空字串備註視為沒有備註", () => {
    expect(parseRelayUploadMeta({ ...good, note: "" })).toEqual({ ...good, note: null });
  });

  it("缺 uploaderId 或格式不對一律 null —— 不建沒有經手人的憑證", () => {
    expect(parseRelayUploadMeta(null)).toBeNull();
    expect(parseRelayUploadMeta("x")).toBeNull();
    expect(parseRelayUploadMeta({ ...good, uploaderId: "" })).toBeNull();
    expect(parseRelayUploadMeta({ ...good, uploaderId: 42 })).toBeNull();
    expect(parseRelayUploadMeta({ ...good, mimeType: "text/html" })).toBeNull();
    expect(parseRelayUploadMeta({ ...good, note: 1 })).toBeNull();
    expect(parseRelayUploadMeta({ ...good, receivedAt: "yesterday" })).toBeNull();
  });
});

describe("classifyUploadResponse", () => {
  it("2xx(含 duplicate 的 200)→ sent", () => {
    expect(classifyUploadResponse(200)).toBe("sent");
    expect(classifyUploadResponse(201)).toBe("sent");
  });

  it("401 → unauthorized(整輪停下)", () => {
    expect(classifyUploadResponse(401)).toBe("unauthorized");
  });

  it("5xx、限流、逾時 → retry-later(不算照片的錯)", () => {
    for (const s of [500, 502, 503, 504, 408, 429]) {
      expect(classifyUploadResponse(s)).toBe("retry-later");
    }
  });

  it("其他 4xx → rejected(照片本身的問題)", () => {
    for (const s of [400, 403, 404, 413, 415]) {
      expect(classifyUploadResponse(s)).toBe("rejected");
    }
  });
});

describe("shouldRefreshRelayCredential", () => {
  const NOW = Date.UTC(2026, 9, 16);

  it("還沒有憑證就要領", () => {
    expect(shouldRefreshRelayCredential(null, NOW)).toBe(true);
  });

  it("一週內不換,滿一週就換", () => {
    expect(shouldRefreshRelayCredential(NOW - RELAY_CREDENTIAL_REFRESH_AFTER_MS + 1, NOW)).toBe(false);
    expect(shouldRefreshRelayCredential(NOW - RELAY_CREDENTIAL_REFRESH_AFTER_MS, NOW)).toBe(true);
  });

  it("簽發時間在未來(時鐘被調過)也換", () => {
    expect(shouldRefreshRelayCredential(NOW + 60_000, NOW)).toBe(true);
  });
});
