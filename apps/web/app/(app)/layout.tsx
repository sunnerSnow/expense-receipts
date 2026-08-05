import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      {/*
        導覽列吸頂並可橫向滑動:手機寬度放不下五個項目,擠成兩行比可滑動更難用。
        「上傳」是這個工具唯一的高頻動作,做成實心 pill 與其他項目區隔。
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
        <Link href="/receipts/new" className="nav-cta spread">
          ＋ 上傳
        </Link>
        <form action={logout}>
          <button type="submit" className="btn btn-quiet" aria-label={`登出 ${user.name}`}>
            登出
          </button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
