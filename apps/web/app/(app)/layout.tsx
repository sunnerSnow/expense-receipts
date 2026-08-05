import Link from "next/link";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      {/*
        導覽列吸頂並可橫向滑動:手機寬度放不下所有項目,擠成兩行比可滑動更難用。
        「上傳」是這個工具唯一的高頻動作,做成實心 pill 與其他項目區隔。
        登出刻意不放這裡 —— 導覽列的位置要留給每天都會用到的東西,
        登出放在 /account(點名字進去)。
      */}
      <nav className="app-nav">
        <Link href="/receipts" className="nav-link">
          單據
        </Link>
        <Link href="/exports" className="nav-link">
          月結
        </Link>
        <Link href="/categories" className="nav-link">
          分類
        </Link>
        {user.role === "admin" ? (
          <Link href="/users" className="nav-link">
            使用者
          </Link>
        ) : null}
        <Link href="/receipts/new" className="nav-cta spread">
          ＋ 上傳
        </Link>
        <Link href="/account" className="nav-link">
          {user.name}
        </Link>
      </nav>
      <main>{children}</main>
    </>
  );
}
