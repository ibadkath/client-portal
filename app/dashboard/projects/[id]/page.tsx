import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { ProjectBoard } from "./project-board";
import { TimeEntriesSection } from "./time-entries-section";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, status, org_id")
    .eq("id", projectId)
    .single();

  // RLS hides rows in another org rather than erroring, so a missing row
  // here means either it doesn't exist or this user can't see it -- 404
  // either way, so we don't leak which.
  if (!project) {
    notFound();
  }

  const { data: milestones } = await supabase
    .from("milestones")
    .select(
      "id, title, description, sequence, status, due_date, deliverables(id, file_name, storage_path, created_at)"
    )
    .eq("project_id", projectId)
    .order("sequence", { ascending: true });

  const deliverableIds = (milestones ?? []).flatMap((m) =>
    (m.deliverables ?? []).map((d) => d.id)
  );

  const { data: comments } = deliverableIds.length
    ? await supabase
        .from("comments")
        .select("id, body, author_id, created_at, deliverable_id")
        .in("deliverable_id", deliverableIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const { data: progress } = await supabase.rpc("project_progress", {
    p_project_id: projectId,
  });

  // Which deliverables *this user* has already downloaded -- feeds the
  // Approve/Reject gating in ProjectBoard. Admin-role rows exist too (an
  // admin uploading and re-downloading their own work), but only clients
  // ever read this set, so skip the round trip for admins.
  const { data: downloads } =
    profile.role === "client" && deliverableIds.length
      ? await supabase
          .from("deliverable_downloads")
          .select("deliverable_id")
          .eq("user_id", profile.id)
          .in("deliverable_id", deliverableIds)
      : { data: [] };

  // time_entries RLS is admin-only on every policy (select included), so a
  // client would just get an empty result -- skip the round trip entirely.
  const { data: timeEntries } =
    profile.role === "admin"
      ? await supabase
          .from("time_entries")
          .select("id, hours, description, entry_date")
          .eq("project_id", projectId)
          .order("entry_date", { ascending: false })
      : { data: null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{project.name}</h1>
        {project.description && (
          <p className="text-sm text-black/60 dark:text-white/60">
            {project.description}
          </p>
        )}
        <p className="mt-1 text-sm">
          Progress: <span className="font-medium">{progress ?? 0}%</span>
        </p>
      </div>

      <ProjectBoard
        projectId={project.id}
        orgId={project.org_id}
        role={profile.role}
        userId={profile.id}
        initialMilestones={milestones ?? []}
        initialComments={comments ?? []}
        initialDownloadedDeliverableIds={(downloads ?? []).map(
          (d) => d.deliverable_id
        )}
        hasTimeEntries={(timeEntries ?? []).length > 0}
      />

      {profile.role === "admin" && (
        <TimeEntriesSection
          projectId={project.id}
          initialEntries={timeEntries ?? []}
        />
      )}
    </div>
  );
}
