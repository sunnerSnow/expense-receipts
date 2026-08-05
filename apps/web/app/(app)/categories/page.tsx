import { asc } from "drizzle-orm";
import { categories } from "@expense-receipts/db";
import { getDb } from "@/lib/db";
import { CreateCategoryForm } from "./CreateCategoryForm";
import { renameCategory, toggleCategory } from "./actions";

export default async function CategoriesPage() {
  const cats = await getDb().select().from(categories).orderBy(asc(categories.sortOrder));

  return (
    <>
      <h1>分類管理</h1>
      <p className="muted small">
        分類是會計科目式的,可自訂。停用的分類不會出現在上傳選單,但既有單據不受影響。
      </p>

      <CreateCategoryForm />

      <div className="list">
        {cats.map((c) => (
          <div className={c.isActive ? "item" : "item item-inactive"} key={c.id}>
            <form action={renameCategory} className="row">
              <input type="hidden" name="id" value={c.id} />
              <input className="input" name="name" defaultValue={c.name} required aria-label="分類名稱" />
              <button type="submit" className="btn btn-sm">
                更名
              </button>
            </form>

            <form action={toggleCategory}>
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className="btn btn-sm">
                {c.isActive ? "停用" : "啟用"}
              </button>
            </form>

            <span className="item-meta">
              <code className="chip tnum">{c.code}</code>
              <span className={c.isActive ? "chip chip-ok" : "chip chip-locked"}>
                {c.isActive ? "啟用中" : "已停用"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
