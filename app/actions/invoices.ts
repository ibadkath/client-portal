"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["draft", "sent", "paid", "overdue"] as const;
type Status = (typeof STATUSES)[number];

// No explicit is_admin() check here on purpose, same pattern as the other
// admin actions: invoices_update's RLS policy (with check is_admin()) is the
// real authority. A client's attempt updates zero rows, surfaced below as an
// error instead of a silent no-op.
export async function updateInvoice(
  invoiceId: string,
  patch: { amount_cents: number; status: Status }
) {
  if (!STATUSES.includes(patch.status)) {
    return { error: "Invalid status." };
  }
  if (!Number.isFinite(patch.amount_cents) || patch.amount_cents < 0) {
    return { error: "Amount must be a non-negative number." };
  }

  const supabase = await createClient();
  const update: Record<string, unknown> = { ...patch };
  if (patch.status === "sent") {
    update.issued_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(update)
    .eq("id", invoiceId)
    .select();

  if (error) {
    return { error: error.message };
  }

  if (!data?.length) {
    return { error: "Not authorized to update this invoice." };
  }

  revalidatePath("/dashboard/invoices");
  return {};
}
