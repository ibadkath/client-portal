"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

// Admin-only end to end: every time_entries RLS policy (select/insert/
// update/delete) requires is_admin() (supabase/migrations/20260723131336_phase2_rls.sql).
// A non-admin caller inserts zero rows, surfaced below as an error, same
// pattern as the other admin actions in this directory.
export async function logTime(projectId: string, formData: FormData) {
  const hours = Number(formData.get("hours"));
  const description = String(formData.get("description") ?? "").trim();
  const entryDate = String(formData.get("entry_date") ?? "").trim();

  if (!Number.isFinite(hours) || hours <= 0) {
    return { error: "Hours must be a positive number." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // org_id is forced by trigger (never trusted from the caller); the
  // generated Insert type can't express "trigger-populated", hence the cast.
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      project_id: projectId,
      admin_id: user?.id ?? null,
      hours,
      description: description || null,
      ...(entryDate ? { entry_date: entryDate } : {}),
    } as Database["public"]["Tables"]["time_entries"]["Insert"])
    .select();

  if (error) {
    return { error: error.message };
  }

  if (!data?.length) {
    return { error: "Not authorized to log time." };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}
