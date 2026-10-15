import { describe, expect, it } from "vitest";
import {
  RELAY_CREDENTIAL_MAX_AGE_MS,
  signRelayCredential,
  verifyRelayCredential,
} from "./relay-credential";

const SECRET = "relay-secret-for-tests-0123456789";
const USER = "8d0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

/** 把 base64url 字串的第一個字元換掉(保持仍是合法 base64url) */
function flipFirstChar(text: string): string {
  return (text[0] === "A" ? "B" : "A") + text.slice(1);
}

describe("signRelayCredential / verifyRelayCredential", () => {
  it("同一把密鑰簽的憑證驗得過,帶回 userId 與簽發時間", async () => {
    const token = await signRelayCredential(SECRET, USER, NOW);
    expect(await verifyRelayCredential(SECRET, token, NOW)).toEqual({
      userId: USER,
      issuedAt: NOW,
    });
  });

  it("換一把密鑰就驗不過(換 RELAY_SECRET = 作廢所有手機的憑證)", async () => {
    const token = await signRelayCredential(SECRET, USER, NOW);
    expect(await verifyRelayCredential("another-secret-entirely-0123456", token, NOW)).toBeNull();
  });

  it("改了內容(例如換成別人的 userId)就驗不過", async () => {
    const mine = await signRelayCredential(SECRET, USER, NOW);
    const other = await signRelayCredential(SECRET, "someone-else", NOW);
    const [, mySig] = mine.split(".");
    const [otherBody] = other.split(".");
    expect(await verifyRelayCredential(SECRET, `${otherBody}.${mySig}`, NOW)).toBeNull();

    const [body, sig] = mine.split(".") as [string, string];
    expect(await verifyRelayCredential(SECRET, `${flipFirstChar(body)}.${sig}`, NOW)).toBeNull();
  });

  it("改了簽章就驗不過", async () => {
    const [body, sig] = (await signRelayCredential(SECRET, USER, NOW)).split(".") as [
      string,
      string,
    ];
    expect(await verifyRelayCredential(SECRET, `${body}.${flipFirstChar(sig)}`, NOW)).toBeNull();
  });

  it("效期內驗得過,過期就驗不過", async () => {
    const token = await signRelayCredential(SECRET, USER, NOW);
    expect(await verifyRelayCredential(SECRET, token, NOW + RELAY_CREDENTIAL_MAX_AGE_MS)).not.toBeNull();
    expect(await verifyRelayCredential(SECRET, token, NOW + RELAY_CREDENTIAL_MAX_AGE_MS + 1)).toBeNull();
  });

  it("容許幾分鐘的時鐘誤差,但明顯是未來簽發的不收", async () => {
    const token = await signRelayCredential(SECRET, USER, NOW);
    expect(await verifyRelayCredential(SECRET, token, NOW - 60_000)).not.toBeNull();
    expect(await verifyRelayCredential(SECRET, token, NOW - 60 * 60_000)).toBeNull();
  });

  it("格式不對一律回 null,不丟例外", async () => {
    for (const bad of ["", ".", "abc", "a.b.c", "!!!.???", "abc.", ".abc"]) {
      expect(await verifyRelayCredential(SECRET, bad, NOW)).toBeNull();
    }
  });

  it("密鑰是空字串時直接丟錯,不靜默簽出任何人都能偽造的憑證", async () => {
    await expect(signRelayCredential("", USER, NOW)).rejects.toThrow("RELAY_SECRET");
  });
});
