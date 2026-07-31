"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// No explicit is_admin() check here on purpose, same reasoning as
// updateMilestoneStatus in milestones.ts: profiles_update's RLS policy
// (using/with check is_admin()) is the actual authority. A non-admin caller
// just updates zero rows -- we detect that via .select() and surface it as
// an error instead of silently no-oping.
export async function updateUserRole(
  userId: string,
  role: "admin" | "client",
  orgId: string | null
) {
  if (role === "client" && !orgId) {
    return { error: "Clients must belong to an organization." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role, org_id: role === "admin" ? null : orgId })
    .eq("id", userId)
    .select();

  if (error) {
    return { error: error.message };
  }

  if (!data?.length) {
    return { error: "Not authorized to change this user's role." };
  }

  revalidatePath("/dashboard/admin/users");
  return {};
}
