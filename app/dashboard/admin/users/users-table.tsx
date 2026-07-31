"use client";

import { useState, useTransition } from "react";
import { updateUserRole } from "@/app/actions/admin";

type Profile = {
  id: string;
  full_name: string | null;
  role: string;
  org_id: string | null;
  org_name: string | null;
};

type Organization = { id: string; name: string };

export function UsersTable({
  currentUserId,
  profiles,
  organizations,
}: {
  currentUserId: string;
  profiles: Profile[];
  organizations: Organization[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-black/10 text-left dark:border-white/10">
          <th className="py-2 pr-4 font-medium">Name</th>
          <th className="py-2 pr-4 font-medium">Organization</th>
          <th className="py-2 pr-4 font-medium">Role</th>
          <th className="py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((profile) => (
          <UserRow
            key={profile.id}
            profile={profile}
            organizations={organizations}
            isSelf={profile.id === currentUserId}
          />
        ))}
        {!profiles.length && (
          <tr>
            <td colSpan={4} className="py-3 text-black/60 dark:text-white/60">
              No users yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function UserRow({
  profile,
  organizations,
  isSelf,
}: {
  profile: Profile;
  organizations: Organization[];
  isSelf: boolean;
}) {
  const [role, setRole] = useState(profile.role);
  const [orgId, setOrgId] = useState(profile.org_id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty = role !== profile.role || (role === "client" && orgId !== (profile.org_id ?? ""));

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateUserRole(
        profile.id,
        role as "admin" | "client",
        role === "client" ? orgId || null : null
      );
      if (res?.error) setError(res.error);
    });
  }

  return (
    <tr className="border-b border-black/5 dark:border-white/5">
      <td className="py-2 pr-4">
        {profile.full_name ?? "—"}
        {isSelf && (
          <span className="ml-2 text-xs text-black/40 dark:text-white/40">
            (you)
          </span>
        )}
      </td>
      <td className="py-2 pr-4">
        {role === "client" ? (
          <select
            value={orgId}
            disabled={pending}
            onChange={(e) => setOrgId(e.target.value)}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          >
            <option value="" disabled>
              Select organization
            </option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-black/40 dark:text-white/40">—</span>
        )}
      </td>
      <td className="py-2 pr-4">
        <select
          value={role}
          disabled={pending}
          onChange={(e) => setRole(e.target.value)}
          className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
        >
          <option value="client">client</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="py-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}
