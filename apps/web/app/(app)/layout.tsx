import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e5e5e5",
          flexWrap: "wrap",
        }}
      >
        <Link href="/receipts" style={{ fontWeight: 600 }}>
          單據
        </Link>
        <Link href="/receipts/new">＋ 上傳</Link>
        <Link href="/exports">月結匯出</Link>
        <Link href="/categories">分類</Link>
        <span style={{ marginLeft: "auto", color: "#666" }}>{user.name}</span>
        <form action={logout}>
          <button type="submit" style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer" }}>
            登出
          </button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
