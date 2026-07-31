import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { InvoicesTable } from "./invoices-table";

export default async function InvoicesPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  // RLS scopes this to the caller's own org for clients, and to everything
  // for admins -- same pattern as the projects list on /dashboard.
  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, amount_cents, status, issued_at, due_at, created_at, projects(name), organizations(name), milestones(title)"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Invoices</h1>
      <InvoicesTable
        isAdmin={profile.role === "admin"}
        invoices={(invoices ?? []).map((invoice) => ({
          id: invoice.id,
          amount_cents: invoice.amount_cents,
          status: invoice.status,
          issued_at: invoice.issued_at,
          due_at: invoice.due_at,
          project_name:
            (invoice.projects as unknown as { name: string } | null)?.name ??
            "—",
          org_name:
            (invoice.organizations as unknown as { name: string } | null)
              ?.name ?? "—",
          milestone_title:
            (invoice.milestones as unknown as { title: string } | null)
              ?.title ?? "—",
        }))}
      />
    </div>
  );
}
