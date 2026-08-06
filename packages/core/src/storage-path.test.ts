import { describe, expect, it } from "vitest";
import { toStorageKey } from "./storage-path";

describe("toStorageKey", () => {
  describe("舊格式:Windows 絕對路徑", () => {
    it("單據影像 → 檔名", () => {
      expect(
        toStorageKey("C:\\Users\\Uanalyze\\Project\\expense-receipts\\uploads\\a.jpg", "uploads"),
      ).toBe("a.jpg");
    });

    it("匯出檔 → 保留期間子目錄", () => {
      expect(
        toStorageKey(
          "C:\\Users\\Uanalyze\\Project\\expense-receipts\\exports\\2026-07\\報帳清單_2026-07.csv",
          "exports",
        ),
      ).toBe("2026-07/報帳清單_2026-07.csv");
    });

    it("換了使用者名稱與磁碟機也解得出來", () => {
      expect(toStorageKey("D:\\work\\er\\uploads\\a.jpg", "uploads")).toBe("a.jpg");
    });
  });

  describe("舊格式:POSIX 絕對路徑", () => {
    it("容器裡的路徑", () => {
      expect(toStorageKey("/data/uploads/a.jpg", "uploads")).toBe("a.jpg");
    });

    it("匯出檔", () => {
      expect(toStorageKey("/srv/app/exports/2026-07/x.zip", "exports")).toBe("2026-07/x.zip");
    });
  });

  describe("新格式:已經是鍵值", () => {
    it("平的檔名原樣沿用", () => {
      expect(toStorageKey("a.jpg", "uploads")).toBe("a.jpg");
    });

    it("帶子目錄的鍵值原樣沿用", () => {
      expect(toStorageKey("2026-07/x.csv", "exports")).toBe("2026-07/x.csv");
    });

    it("開頭的 ./ 會被清掉", () => {
      expect(toStorageKey("./a.jpg", "uploads")).toBe("a.jpg");
    });
  });

  describe("根目錄名的比對", () => {
    it("rootDirName 給完整路徑也可以(只取最後一段)", () => {
      expect(toStorageKey("/data/uploads/a.jpg", "/data/uploads")).toBe("a.jpg");
      expect(toStorageKey("C:\\x\\uploads\\a.jpg", ".\\uploads")).toBe("a.jpg");
    });

    it("Windows 路徑大小寫不敏感", () => {
      expect(toStorageKey("C:\\X\\Uploads\\a.jpg", "uploads")).toBe("a.jpg");
    });

    it("取最靠近檔案的那一層同名目錄", () => {
      expect(toStorageKey("/uploads/backup/uploads/a.jpg", "uploads")).toBe("a.jpg");
    });

    it("檔名剛好等於根目錄名時不會被當成目錄", () => {
      expect(toStorageKey("/data/uploads/uploads", "uploads")).toBe("uploads");
    });

    it("絕對路徑但找不到根目錄名 → 退回檔名", () => {
      expect(toStorageKey("C:\\somewhere\\else\\a.jpg", "uploads")).toBe("a.jpg");
    });
  });

  describe("拒絕不安全或無意義的輸入", () => {
    it("空字串", () => {
      expect(toStorageKey("", "uploads")).toBeNull();
      expect(toStorageKey("   ", "uploads")).toBeNull();
    });

    it("只有分隔符號", () => {
      expect(toStorageKey("/", "uploads")).toBeNull();
      expect(toStorageKey("./", "uploads")).toBeNull();
    });

    it("相對路徑裡的 .. 一律拒絕(路徑逃逸)", () => {
      expect(toStorageKey("../../etc/passwd", "uploads")).toBeNull();
      expect(toStorageKey("a/../../b.jpg", "uploads")).toBeNull();
    });

    it("根目錄後面還有 .. 也拒絕", () => {
      expect(toStorageKey("/data/uploads/../../secret.txt", "uploads")).toBeNull();
    });

    it("殘留的磁碟機代號拒絕", () => {
      expect(toStorageKey("C:/a.jpg", "uploads")).toBe("a.jpg");
      expect(toStorageKey("uploads/C:/a.jpg", "uploads")).toBeNull();
    });
  });
});
