"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateMilestoneStatus } from "@/app/actions/milestones";
import { addComment } from "@/app/actions/comments";
import {
  recordDeliverable,
  getDeliverableDownloadUrl,
  deleteDeliverable,
} from "@/app/actions/deliverables";
import { NewMilestoneForm } from "./new-milestone-form";

type Deliverable = {
  id: string;
  file_name: string;
  storage_path: string;
  created_at: string;
};

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  sequence: number;
  status: string;
  due_date: string | null;
  deliverables: Deliverable[] | null;
};

type Comment = {
  id: string;
  body: string;
  author_id: string | null;
  created_at: string;
  deliverable_id: string;
};

const EMPLOYEE_STATUSES = ["pending", "in_progress", "completed"] as const;

export function ProjectBoard({
  projectId,
  orgId,
  role,
  userId,
  initialMilestones,
  initialComments,
  initialDownloadedDeliverableIds,
  hasTimeEntries,
}: {
  projectId: string;
  orgId: string;
  role: string;
  userId: string;
  initialMilestones: Milestone[];
  initialComments: Comment[];
  initialDownloadedDeliverableIds: string[];
  hasTimeEntries: boolean;
}) {
  const [milestones, setMilestones] =
    useState<Milestone[]>(initialMilestones);
  const [comments, setComments] = useState<Comment[]>(initialComments);
  // Which deliverables *this* client has fetched a download link for --
  // the client-side mirror of the deliverable_downloads rows that
  // enforce_milestone_client_update() actually checks server-side before
  // allowing approve/reject. Used only to drive the UI (enable/disable the
  // decision buttons); the trigger is the real gate.
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(
    () => new Set(initialDownloadedDeliverableIds)
  );
  const markDownloaded = (deliverableId: string) =>
    setDownloadedIds((prev) => new Set(prev).add(deliverableId));

  const deliverableIds = useMemo(
    () =>
      new Set(
        milestones.flatMap((m) => (m.deliverables ?? []).map((d) => d.id))
      ),
    [milestones]
  );
  // The comments socket below is set up once (deps: [projectId, orgId]) so
  // its handler closure would otherwise freeze deliverableIds at whatever it
  // was when the socket was created. A ref keeps it live without tearing
  // down/rebuilding the socket every time milestones/deliverables change.
  const deliverableIdsRef = useRef(deliverableIds);
  useEffect(() => {
    deliverableIdsRef.current = deliverableIds;
  }, [deliverableIds]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let milestonesChannel: ReturnType<typeof supabase.channel> | undefined;
    let deliverablesChannel: ReturnType<typeof supabase.channel> | undefined;
    let commentsChannel: ReturnType<typeof supabase.channel> | undefined;

    // These channels carry org/project-scoped RLS filters, so Realtime only
    // delivers a row if the socket's JOIN was authenticated as this user.
    // The client's internal auth->realtime wiring applies the JWT
    // asynchronously (on an auth-state-change event), which can lose the
    // race against this effect creating channels on mount -- the channels
    // still report "subscribed" but silently never receive a row, since
    // Postgres evaluates the RLS policy as the anon role. Awaiting the
    // session and explicitly calling setAuth before creating any channel
    // guarantees the join always carries the real JWT.
    async function setup() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;

      milestonesChannel = supabase
        .channel(`milestones:${projectId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "milestones",
            filter: `project_id=eq.${projectId}`,
          },
          (payload) => {
            setMilestones((prev) => {
              if (payload.eventType === "DELETE") {
                const oldId = (payload.old as { id: string }).id;
                return prev.filter((m) => m.id !== oldId);
              }

              const row = payload.new as Omit<Milestone, "deliverables">;

              const existing = prev.find((m) => m.id === row.id);
              if (existing) {
                return prev.map((m) =>
                  m.id === row.id ? { ...m, ...row } : m
                );
              }

              return [...prev, { ...row, deliverables: [] }].sort(
                (a, b) => a.sequence - b.sequence
              );
            });
          }
        )
        .subscribe();

      deliverablesChannel = supabase
        .channel(`deliverables:${orgId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "deliverables",
            filter: `org_id=eq.${orgId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              setMilestones((prev) =>
                prev.map((m) => ({
                  ...m,
                  deliverables: (m.deliverables ?? []).filter(
                    (d) => d.id !== oldId
                  ),
                }))
              );
              return;
            }

            const row = payload.new as Deliverable & { milestone_id: string };
            setMilestones((prev) => {
              // Deliverables realtime is org-scoped (no project_id of its
              // own); ignore rows for a milestone we haven't loaded -- i.e.
              // a different project in the same org.
              if (!prev.some((m) => m.id === row.milestone_id)) return prev;

              return prev.map((m) => {
                if (m.id !== row.milestone_id) return m;
                const deliverable: Deliverable = {
                  id: row.id,
                  file_name: row.file_name,
                  storage_path: row.storage_path,
                  created_at: row.created_at,
                };
                const existing = m.deliverables ?? [];
                const next = existing.some((d) => d.id === deliverable.id)
                  ? existing.map((d) =>
                      d.id === deliverable.id ? deliverable : d
                    )
                  : [...existing, deliverable];
                return { ...m, deliverables: next };
              });
            });
          }
        )
        .subscribe();

      commentsChannel = supabase
        .channel(`comments:${orgId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "comments",
            filter: `org_id=eq.${orgId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              setComments((prev) => prev.filter((c) => c.id !== oldId));
              return;
            }

            const row = payload.new as Comment;
            // Comments realtime is org-scoped (comments have no project_id
            // of their own); ignore rows belonging to a deliverable we
            // haven't loaded -- i.e. a different project in the same org.
            // Read via the ref (see above) so a deliverable added after this
            // socket was set up is still recognized.
            if (!deliverableIdsRef.current.has(row.deliverable_id)) return;

            setComments((prev) =>
              prev.some((c) => c.id === row.id) ? prev : [...prev, row]
            );
          }
        )
        .subscribe();
    }

    setup();

    return () => {
      cancelled = true;
      if (milestonesChannel) supabase.removeChannel(milestonesChannel);
      if (deliverablesChannel) supabase.removeChannel(deliverablesChannel);
      if (commentsChannel) supabase.removeChannel(commentsChannel);
    };
  }, [projectId, orgId]);

  return (
    <div className="space-y-6">
      {role === "admin" && <NewMilestoneForm projectId={projectId} />}

      {milestones
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((milestone) => (
          <MilestoneCard
            key={milestone.id}
            projectId={projectId}
            orgId={orgId}
            userId={userId}
            role={role}
            milestone={milestone}
            comments={comments.filter((c) =>
              (milestone.deliverables ?? []).some(
                (d) => d.id === c.deliverable_id
              )
            )}
            downloadedIds={downloadedIds}
            onDownloaded={markDownloaded}
            hasTimeEntries={hasTimeEntries}
          />
        ))}
    </div>
  );
}

function MilestoneCard({
  projectId,
  orgId,
  userId,
  role,
  milestone,
  comments,
  downloadedIds,
  onDownloaded,
  hasTimeEntries,
}: {
  projectId: string;
  orgId: string;
  userId: string;
  role: string;
  milestone: Milestone;
  comments: Comment[];
  downloadedIds: Set<string>;
  onDownloaded: (deliverableId: string) => void;
  hasTimeEntries: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const deliverables = milestone.deliverables ?? [];
  const hasDeliverables = deliverables.length > 0;
  const allDownloaded =
    hasDeliverables && deliverables.every((d) => downloadedIds.has(d.id));
  const canReview = allDownloaded;
  const isTerminal =
    milestone.status === "approved" || milestone.status === "rejected";

  function setStatus(status: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateMilestoneStatus(projectId, milestone.id, status);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-medium">
            {milestone.sequence}. {milestone.title}
          </h2>
          {milestone.description && (
            <p className="text-sm text-black/60 dark:text-white/60">
              {milestone.description}
            </p>
          )}
        </div>
        <StatusBadge status={milestone.status} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        {role === "admin" && (
          <select
            value={
              EMPLOYEE_STATUSES.includes(
                milestone.status as (typeof EMPLOYEE_STATUSES)[number]
              )
                ? milestone.status
                : ""
            }
            disabled={pending || isTerminal}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          >
            {!EMPLOYEE_STATUSES.includes(
              milestone.status as (typeof EMPLOYEE_STATUSES)[number]
            ) && (
              <option value="" disabled>
                {milestone.status}
              </option>
            )}
            {EMPLOYEE_STATUSES.map((s) => (
              <option
                key={s}
                value={s}
                disabled={s === "completed" && !hasDeliverables}
              >
                {s === "completed" && !hasDeliverables
                  ? "completed (upload a deliverable first)"
                  : s}
              </option>
            ))}
          </select>
        )}

        {role === "client" && milestone.status === "completed" && (
          <>
            <button
              type="button"
              disabled={pending || !canReview}
              onClick={() => setStatus("approved")}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending || !canReview}
              onClick={() => setStatus("rejected")}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
      </div>

      {role === "admin" && isTerminal && (
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          This milestone was {milestone.status} by the client and can no
          longer be changed.
        </p>
      )}

      {role === "client" &&
        milestone.status === "completed" &&
        !canReview && (
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            Download and review every deliverable before approving or rejecting.
          </p>
        )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        {deliverables.map((deliverable) => (
          <DeliverableCard
            key={deliverable.id}
            projectId={projectId}
            userId={userId}
            role={role}
            deliverable={deliverable}
            canDelete={milestone.status === "in_progress"}
            comments={comments.filter(
              (c) => c.deliverable_id === deliverable.id
            )}
            onDownloaded={onDownloaded}
          />
        ))}

        {role === "admin" && milestone.status === "pending" && (
          <p className="text-sm text-black/60 dark:text-white/60">
            Set this milestone to in_progress before uploading deliverables.
          </p>
        )}

        {role === "admin" &&
          milestone.status !== "pending" &&
          !hasTimeEntries && (
            <p className="text-sm text-black/60 dark:text-white/60">
              Log a time entry before uploading deliverables.
            </p>
          )}

        {role === "admin" &&
          milestone.status !== "pending" &&
          hasTimeEntries && (
            <UploadDeliverableForm
              projectId={projectId}
              milestoneId={milestone.id}
              orgId={orgId}
            />
          )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "approved"
      ? "bg-green-600/10 text-green-700 dark:text-green-400"
      : status === "rejected"
        ? "bg-red-600/10 text-red-700 dark:text-red-400"
        : status === "completed"
          ? "bg-blue-600/10 text-blue-700 dark:text-blue-400"
          : "bg-black/5 dark:bg-white/10";

  return (
    <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{status}</span>
  );
}

function DeliverableCard({
  projectId,
  userId,
  role,
  deliverable,
  canDelete,
  comments,
  onDownloaded,
}: {
  projectId: string;
  userId: string;
  role: string;
  deliverable: Deliverable;
  canDelete: boolean;
  comments: Comment[];
  onDownloaded: (deliverableId: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDownload() {
    setLoadingUrl(true);
    setDownloadError(null);
    const res = await getDeliverableDownloadUrl(
      deliverable.id,
      deliverable.storage_path
    );
    if (!res.url) {
      setLoadingUrl(false);
      setDownloadError(res.error ?? "Could not generate a download link.");
      return;
    }
    const downloadUrl = res.url;
    onDownloaded(deliverable.id);

    if (role === "client") {
      // Clients get the actual file, not just a link to click again --
      // fetch it into a blob and trigger a synthetic <a download> click so
      // the browser saves it straight to disk, ready to open.
      try {
        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) throw new Error();
        const blob = await fileRes.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = deliverable.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } catch {
        setDownloadError("Could not download file.");
      }
      setLoadingUrl(false);
      return;
    }

    setLoadingUrl(false);
    setUrl(downloadUrl);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteDeliverable(
      projectId,
      deliverable.id,
      deliverable.storage_path
    );
    setDeleting(false);
    if (res?.error) setDeleteError(res.error);
  }

  return (
    <div className="rounded border border-black/10 p-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{deliverable.file_name}</span>
        <div className="flex items-center gap-2">
          {role === "client" ? (
            <button
              type="button"
              onClick={handleDownload}
              disabled={loadingUrl}
              className="text-sm underline underline-offset-2 disabled:opacity-50"
            >
              {loadingUrl ? "Downloading..." : "Download"}
            </button>
          ) : url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline underline-offset-2"
            >
              Open
            </a>
          ) : (
            <button
              type="button"
              onClick={handleDownload}
              disabled={loadingUrl}
              className="text-sm underline underline-offset-2 disabled:opacity-50"
            >
              {loadingUrl ? "Generating link..." : "Get link"}
            </button>
          )}
          {role === "admin" && canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Remove deliverable"
              title="Remove deliverable"
              className="text-2xl leading-none text-black/50 hover:text-red-600 disabled:opacity-50 dark:text-white/50"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {downloadError && (
        <p className="mt-1 text-xs text-red-600">{downloadError}</p>
      )}
      {deleteError && <p className="mt-1 text-xs text-red-600">{deleteError}</p>}

      <CommentThread
        projectId={projectId}
        deliverableId={deliverable.id}
        userId={userId}
        role={role}
        comments={comments}
      />
    </div>
  );
}

function CommentThread({
  projectId,
  deliverableId,
  userId,
  role,
  comments,
}: {
  projectId: string;
  deliverableId: string;
  userId: string;
  role: string;
  comments: Comment[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-2 space-y-2">
      <ul className="space-y-1">
        {comments
          .slice()
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          )
          .map((c) => (
            <li key={c.id} className="text-sm">
              <span className="text-black/60 dark:text-white/60">
                {c.author_id === userId ? "You" : "Comment"}:
              </span>{" "}
              {c.body}
            </li>
          ))}
        {!comments.length && (
          <li className="text-sm text-black/40 dark:text-white/40">
            No comments yet.
          </li>
        )}
      </ul>

      {role === "client" && (
        <form
          ref={formRef}
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await addComment(projectId, deliverableId, formData);
              if (res?.error) setError(res.error);
              else formRef.current?.reset();
            });
          }}
          className="flex gap-2"
        >
          <input
            name="body"
            placeholder="Add a comment"
            disabled={pending}
            className="flex-1 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Send
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function UploadDeliverableForm({
  projectId,
  milestoneId,
  orgId,
}: {
  projectId: string;
  milestoneId: string;
  orgId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);

  function clearSelectedFile() {
    setSelectedFile(null);
    setInputKey((k) => k + 1);
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        const file = formData.get("file");
        if (!(file instanceof File) || file.size === 0) {
          setError("Choose a file first");
          return;
        }

        startTransition(async () => {
          // Uploaded directly from the browser to Storage -- the
          // deliverables_storage_insert policy already restricts this to
          // admins, so this is no less safe than routing it through a
          // server action, and it avoids the 1MB Server Action body cap.
          const path = `${orgId}/${projectId}/${Date.now()}-${file.name}`;
          const supabase = createClient();
          const { error: uploadError } = await supabase.storage
            .from("deliverables")
            .upload(path, file);
          if (uploadError) {
            setError(uploadError.message);
            return;
          }

          const res = await recordDeliverable(
            projectId,
            milestoneId,
            path,
            file.name
          );
          if (res?.error) setError(res.error);
          else clearSelectedFile();
        });
      }}
      className="flex items-center gap-2"
    >
      <input
        type="file"
        name="file"
        disabled={pending}
        className="text-sm"
        key={inputKey}
        onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
      />
      {selectedFile && !pending && (
        <button
          type="button"
          onClick={clearSelectedFile}
          aria-label="Remove selected file"
          title="Remove selected file"
          className="text-2xl leading-none text-black/50 hover:text-red-600 dark:text-white/50"
        >
          ×
        </button>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20"
      >
        {pending ? "Uploading..." : "Upload deliverable"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
