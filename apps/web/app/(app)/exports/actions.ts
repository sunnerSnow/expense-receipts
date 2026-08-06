"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { sendExportJob } from "@/lib/queue";

export type ExportActionState = { error?: string; queued?: string };

/**
 * 發起月結匯出。
 *
 * 這裡只做「檢查輸入 + 派工」—— 撈單據、產檔、轉狀態都在 worker(見
 * apps/worker/src/jobs/generate-export.ts),因為那是會寫入終態的操作,
 * 需要交易保護,不適合放在 server action 裡邊做邊回應。
 */
export async function requestExport(
  _prev: ExportActionState,
  formData: FormData,
): Promise<ExportActionState> {
  const user = await requireUser();

  const period = String(formData.get("period") ?? "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return { error: "請選擇要匯出的月份" };

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return { error: "月份不正確" };

  try {
    await sendExportJob({ periodYear: year, periodMonth: month, createdBy: user.id });
  } catch (err) {
    return { error: (err as Error)?.message ?? "匯出工作派送失敗" };
  }

  revalidatePath("/exports");
  return { queued: period };
}
