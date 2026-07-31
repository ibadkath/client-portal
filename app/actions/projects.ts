"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// No explicit is_admin() check here on purpose, same pattern as
// updateUserRole in admin.ts: projects_insert's RLS policy (with check
// is_admin()) is the actual authority. A non-admin caller just inserts zero
// rows -- .select() lets us detect that and surface a clear error instead
// of a silent no-op.
export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const orgId = String(formData.get("org_id") ?? "");

  if (!name || !orgId) {
    return { error: "Name and organization are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ name, description: description || null, org_id: orgId })
    .select();

  if (error) {
    return { error: error.message };
  }

  if (!data?.length) {
    return { error: "Not authorized to create projects." };
  }

  revalidatePath("/dashboard");
  return {};
}
