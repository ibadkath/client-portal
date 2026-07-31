import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { NewProjectForm } from "./new-project-form";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  org_id: string;
};

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  // RLS already scopes this to the caller's own org for clients, and to
  // everything for admins -- no manual org_id filter needed here.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, status, org_id, organizations(name)")
    .order("created_at", { ascending: false });

  const { data: organizations } =
    profile.role === "admin"
      ? await supabase.from("organizations").select("id, name").order("name")
      : { data: null };

  // Outstanding-invoice total for the summary strip -- admin-only, cheap
  // since RLS already scopes invoices to "everything" for admins.
  const { data: invoices } =
    profile.role === "admin"
      ? await supabase.from("invoices").select("amount_cents, status")
      : { data: null };

  const outstandingCents = (invoices ?? [])
    .filter((invoice) => invoice.status === "sent" || invoice.status === "overdue")
    .reduce((sum, invoice) => sum + invoice.amount_cents, 0);

  const activeProjectCount = (projects ?? []).filter(
    (project) => project.status === "active"
  ).length;

  // Grouped by org for the admin view only -- a client only ever has one
  // org's projects anyway, so grouping would just add a redundant header.
  const projectsByOrg = new Map<string, { name: string; projects: ProjectRow[] }>();
  for (const project of projects ?? []) {
    const orgName =
      (project.organizations as unknown as { name: string } | null)?.name ??
      "—";
    const group = projectsByOrg.get(project.org_id);
    if (group) {
      group.projects.push(project);
    } else {
      projectsByOrg.set(project.org_id, { name: orgName, projects: [project] });
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Projects</h1>

      {profile.role === "admin" && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Clients" value={organizations?.length ?? 0} />
            <SummaryCard label="Active projects" value={activeProjectCount} />
            <SummaryCard
              label="Outstanding invoices"
              value={`$${(outstandingCents / 100).toFixed(2)}`}
            />
          </div>

          <NewProjectForm organizations={organizations ?? []} />
        </>
      )}

      {!projects?.length && (
        <p className="text-sm text-black/60 dark:text-white/60">
          No projects yet.
        </p>
      )}

      {profile.role === "admin" ? (
        <div className="space-y-6">
          {[...projectsByOrg.entries()].map(([orgId, group]) => (
            <div key={orgId}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-black/60 dark:text-white/60">
                {group.name}
                <span className="rounded bg-black/5 px-2 py-0.5 text-xs font-normal dark:bg-white/10">
                  {statusSummary(group.projects)}
                </span>
              </h2>
              <ProjectList projects={group.projects} />
            </div>
          ))}
        </div>
      ) : (
        <ProjectList projects={projects ?? []} />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <p className="text-xs text-black/60 dark:text-white/60">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function statusSummary(projects: ProjectRow[]) {
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
}

function ProjectList({ projects }: { projects: ProjectRow[] }) {
  return (
    <ul className="divide-y divide-black/10 dark:divide-white/10">
      {projects.map((project) => (
        <li key={project.id} className="py-3">
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="font-medium underline underline-offset-2"
          >
            {project.name}
          </Link>
          <span className="ml-2 rounded bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
            {project.status}
          </span>
          {project.description && (
            <p className="text-sm text-black/60 dark:text-white/60">
              {project.description}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
