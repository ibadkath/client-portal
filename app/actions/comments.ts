"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export async function addComment(
  projectId: string,
  deliverableId: string,
  formData: FormData
) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    return { error: "Comment cannot be empty" };
  }

  const supabase = await createClient();
  // org_id/author_id are forced by trigger (never trusted from the caller);
  // the generated Insert type can't express "trigger-populated", hence the cast.
  const { error } = await supabase.from("comments").insert({
    deliverable_id: deliverableId,
    body,
  } as Database["public"]["Tables"]["comments"]["Insert"]);

  if (error) {
    return { error: error.message };
  }

  // Realtime pushes this to every other open tab; revalidate so this same
  // tab's non-JS fallback path (and a fresh load) also see it immediately.
  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}
