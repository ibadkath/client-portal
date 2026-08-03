"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

// The file itself is uploaded straight from the browser to Supabase
// Storage (see UploadDeliverableForm in project-board.tsx) -- not routed
// through this server action -- because Server Actions cap the request
// body at 1MB by default and any real deliverable will exceed that. This
// action only records the small metadata row once the browser upload has
// already succeeded.
//
// Admin-only in practice: both the storage.objects insert policy and the
// deliverables table insert policy (supabase/migrations/20260724124616_phase3_storage.sql,
// 20260723131336_phase2_rls.sql) require is_admin(). A client's attempt
// fails at the storage/table layer and its error message is returned as-is.
export async function recordDeliverable(
  projectId: string,
  milestoneId: string,
  path: string,
  fileName: string
) {
  const supabase = await createClient();

  // org_id is forced by trigger (never trusted from the caller); the
  // generated Insert type can't express "trigger-populated", hence the cast.
  const { error } = await supabase.from("deliverables").insert({
    milestone_id: milestoneId,
    storage_path: path,
    file_name: fileName,
  } as Database["public"]["Tables"]["deliverables"]["Insert"]);
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// Logs the download *before* generating the link, and fails the whole call
// if the log insert fails. This row is the only server-observable evidence
// that a deliverable was ever fetched -- enforce_milestone_client_update()
// requires one per deliverable before a client can approve/reject the
// milestone (supabase/migrations/20260729130000_enforce_deliverable_review_before_approval.sql).
// org_id/user_id are forced by trigger, never trusted from the caller.
export async function getDeliverableDownloadUrl(
  deliverableId: string,
  path: string
) {
  const supabase = await createClient();

  const { error: logError } = await supabase.from("deliverable_downloads").insert({
    deliverable_id: deliverableId,
  } as Database["public"]["Tables"]["deliverable_downloads"]["Insert"]);
  if (logError) {
    return { error: logError.message };
  }

  const { data, error } = await supabase.storage
    .from("deliverables")
    .createSignedUrl(path, 300);

  if (error) {
    return { error: error.message };
  }
  return { url: data.signedUrl };
}

// Storage object is removed first -- if that fails we bail before touching
// the row, so we never end up with a table row pointing at a file that's
// already gone. deliverables_storage_delete/deliverables_delete (both
// is_admin()-only) do the actual authorization; this just orders the calls.
export async function deleteDeliverable(
  projectId: string,
  deliverableId: string,
  path: string
) {
  const supabase = await createClient();

  const { error: storageError } = await supabase.storage
    .from("deliverables")
    .remove([path]);
  if (storageError) {
    return { error: storageError.message };
  }

  const { error } = await supabase
    .from("deliverables")
    .delete()
    .eq("id", deliverableId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}
