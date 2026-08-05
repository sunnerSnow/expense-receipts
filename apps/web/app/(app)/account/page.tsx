import { requireUser } from "@/lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <>
      <h1>帳號</h1>

      <section className="card">
        <div className="row-between">
          <div className="stack-sm">
            <span className="stat-label">{user.email}</span>
            <strong>{user.name}</strong>
          </div>
          <span className={user.role === "admin" ? "chip chip-ok" : "chip"}>
            {user.role === "admin" ? "管理者" : "成員"}
          </span>
        </div>
      </section>

      <ChangePasswordForm />
    </>
  );
}
