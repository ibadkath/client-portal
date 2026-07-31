"use client";

import { useRef, useState, useTransition } from "react";
import { createProject } from "@/app/actions/projects";

export function NewProjectForm({
  organizations,
}: {
  organizations: { id: string; name: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await createProject(formData);
          if (res?.error) setError(res.error);
          else formRef.current?.reset();
        });
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <div className="space-y-1">
        <label htmlFor="org_id" className="text-sm">
          Organization
        </label>
        <select
          id="org_id"
          name="org_id"
          required
          disabled={pending}
          defaultValue=""
          className="rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
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
      </div>

      <div className="space-y-1">
        <label htmlFor="name" className="text-sm">
          Project name
        </label>
        <input
          id="name"
          name="name"
          required
          disabled={pending}
          className="rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="description" className="text-sm">
          Description
        </label>
        <input
          id="description"
          name="description"
          disabled={pending}
          className="rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Creating..." : "Create project"}
      </button>

      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
