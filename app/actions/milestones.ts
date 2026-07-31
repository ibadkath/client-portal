"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// No role branching here on purpose: enforce_milestone_client_update() in
// supabase/migrations/20260727150000_close_milestone_insert_gap.sql is the
// authority on who may set which status. This action just forwards the
// request and surfaces the trigger's exception message if it's rejected.
export async function updateMilestoneStatus(
  projectId: string,
  milestoneId: string,
  status: string
) {
  const supabase = await createClient();

  // Read the status before mutating -- needed to detect a
  // completed -> pending/in_progress reversion, so whatever was uploaded
  // while it was "done" can be cleared out below (a reverted milestone
  // shouldn't keep stale deliverables from the attempt that got walked back).
  const { data: before } = await supabase
    .from("milestones")
    .select("status")
    .eq("id", milestoneId)
    .single();

  const { error } = await supabase
    .from("milestones")
    .update({ status })
    .eq("id", milestoneId);

  if (error) {
    return { error: error.message };
  }

  if (
    before?.status === "completed" &&
    (status === "pending" || status === "in_progress")
  ) {
    const { data: deliverables } = await supabase
      .from("deliverables")
      .select("id, storage_path")
      .eq("milestone_id", milestoneId);

    if (deliverables?.length) {
      await supabase.storage
        .from("deliverables")
        .remove(deliverables.map((d) => d.storage_path));
      await supabase.from("deliverables").delete().eq("milestone_id", milestoneId);
    }
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// milestones_insert's RLS policy (with check is_admin()) is the real
// authority, same pattern as createProject -- a non-admin caller inserts
// zero rows, surfaced below as an error. Sequence is computed here rather
// than typed by the admin so it can't collide with the unique
// (project_id, sequence) constraint under normal use.
export async function createMilestone(projectId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();

  if (!title) {
    return { error: "Title is required." };
  }

  const supabase = await createClient();

  const { data: last } = await supabase
    .from("milestones")
    .select("sequence")
    .eq("project_id", projectId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("milestones")
    .insert({
      project_id: projectId,
      title,
      description: description || null,
      due_date: dueDate || null,
      sequence: (last?.sequence ?? 0) + 1,
    })
    .select();

  if (error) {
    return { error: error.message };
  }

  if (!data?.length) {
    return { error: "Not authorized to create milestones." };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}
