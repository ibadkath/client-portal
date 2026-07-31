"use client";

import { useRef, useState, useTransition } from "react";
import { logTime } from "@/app/actions/time-entries";

type TimeEntry = {
  id: string;
  hours: number;
  description: string | null;
  entry_date: string;
};

// Reads straight from the initialEntries prop rather than mirroring it into
// state -- logTime's revalidatePath re-fetches this Server Component prop on
// success, which is all the freshness this needs (no realtime requirement
// for time entries in the brief, unlike milestones/comments).
export function TimeEntriesSection({
  projectId,
  initialEntries,
}: {
  projectId: string;
  initialEntries: TimeEntry[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const totalHours = initialEntries.reduce(
    (sum, entry) => sum + Number(entry.hours),
    0
  );

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Time entries</h2>
        <span className="text-sm text-black/60 dark:text-white/60">
          {totalHours} hours logged
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {initialEntries
          .slice()
          .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
          .map((entry) => (
            <li key={entry.id} className="text-sm">
              <span className="font-medium">{entry.hours}h</span>{" "}
              <span className="text-black/60 dark:text-white/60">
                on {entry.entry_date}
              </span>
              {entry.description && <> — {entry.description}</>}
            </li>
          ))}
        {!initialEntries.length && (
          <li className="text-sm text-black/40 dark:text-white/40">
            No hours logged yet.
          </li>
        )}
      </ul>

      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const res = await logTime(projectId, formData);
            if (res?.error) setError(res.error);
            else formRef.current?.reset();
          });
        }}
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <div className="space-y-1">
          <label htmlFor="hours" className="text-sm">
            Hours
          </label>
          <input
            id="hours"
            name="hours"
            type="number"
            step="0.25"
            min="0.25"
            required
            disabled={pending}
            className="w-24 rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="entry_date" className="text-sm">
            Date
          </label>
          <input
            id="entry_date"
            name="entry_date"
            type="date"
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
          {pending ? "Logging..." : "Log hours"}
        </button>

        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
