"use client";

import { useRef, useState, useTransition } from "react";
import { createMilestone } from "@/app/actions/milestones";

export function NewMilestoneForm({ projectId }: { projectId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await createMilestone(projectId, formData);
          if (res?.error) setError(res.error);
          else formRef.current?.reset();
        });
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <div className="space-y-1">
        <label htmlFor="title" className="text-sm">
          Milestone title
        </label>
        <input
          id="title"
          name="title"
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

      <div className="space-y-1">
        <label htmlFor="due_date" className="text-sm">
          Due date
        </label>
        <input
          id="due_date"
          name="due_date"
          type="date"
          disabled={pending}
          className="rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Adding..." : "Add milestone"}
      </button>

      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
