import { redirect } from "next/navigation";

export default function Home() {
  // (app) 群組的版面會在未登入時把 /receipts 導回 /login
  redirect("/receipts");
}
