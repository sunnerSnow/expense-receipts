import { asc } from "drizzle-orm";
import { categories } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { CreateCategoryForm } from "./CreateCategoryForm";
import { renameCategory, toggleCategory } from "./actions";

const cell = { padding: "0.4rem 0.5rem", borderBottom: "1px solid #eee", textAlign: "left" } as const;

export default async function CategoriesPage() {
  const cats = await getDb()
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder));

  return (
    <>
      <h1>分類管理</h1>
      <p style={{ color: "#666" }}>分類為會計科目式,可自訂。停用的分類不會出現在上傳選單,但既有單據不受影響。</p>

      <CreateCategoryForm />

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
          <thead>
            <tr>
              <th style={cell}>代碼</th>
              <th style={cell}>名稱</th>
              <th style={cell}>狀態</th>
              <th style={cell}>操作</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.5 }}>
                <td style={cell}>
                  <code>{c.code}</code>
                </td>
                <td style={cell}>
                  <form action={renameCategory} style={{ display: "flex", gap: "0.4rem" }}>
                    <input type="hidden" name="id" value={c.id} />
                    <input name="name" defaultValue={c.name} required style={{ padding: "0.3rem" }} />
                    <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                      更名
                    </button>
                  </form>
                </td>
                <td style={cell}>{c.isActive ? "啟用" : "停用"}</td>
                <td style={cell}>
                  <form action={toggleCategory}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                      {c.isActive ? "停用" : "啟用"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
