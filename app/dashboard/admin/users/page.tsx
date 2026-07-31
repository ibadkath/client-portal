import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage() {
  const profile = await getProfile();

  if (profile.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role, org_id, organizations(name)")
    .order("created_at", { ascending: true });

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name", { ascending: true });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <UsersTable
        currentUserId={profile.id}
        profiles={(profiles ?? []).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          role: p.role,
          org_id: p.org_id,
          org_name:
            (p.organizations as unknown as { name: string } | null)?.name ??
            null,
        }))}
        organizations={organizations ?? []}
      />
    </div>
  );
}
