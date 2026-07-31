"use client";

import { useState, useTransition } from "react";
import { updateInvoice } from "@/app/actions/invoices";

type Invoice = {
  id: string;
  amount_cents: number;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  project_name: string;
  org_name: string;
  milestone_title: string;
};

const STATUSES = ["draft", "sent", "paid", "overdue"] as const;

export function InvoicesTable({
  isAdmin,
  invoices,
}: {
  isAdmin: boolean;
  invoices: Invoice[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-black/10 text-left dark:border-white/10">
          <th className="py-2 pr-4 font-medium">Project</th>
          <th className="py-2 pr-4 font-medium">Milestone</th>
          {isAdmin && <th className="py-2 pr-4 font-medium">Organization</th>}
          <th className="py-2 pr-4 font-medium">Amount</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice} isAdmin={isAdmin} />
        ))}
        {!invoices.length && (
          <tr>
            <td
              colSpan={isAdmin ? 6 : 5}
              className="py-3 text-black/60 dark:text-white/60"
            >
              No invoices yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function InvoiceRow({
  invoice,
  isAdmin,
}: {
  invoice: Invoice;
  isAdmin: boolean;
}) {
  const [amount, setAmount] = useState((invoice.amount_cents / 100).toFixed(2));
  const [status, setStatus] = useState(invoice.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty =
    status !== invoice.status ||
    Math.round(Number(amount) * 100) !== invoice.amount_cents;

  function save() {
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Enter a valid amount.");
      return;
    }
    startTransition(async () => {
      const res = await updateInvoice(invoice.id, {
        amount_cents: cents,
        status: status as (typeof STATUSES)[number],
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <tr className="border-b border-black/5 dark:border-white/5">
      <td className="py-2 pr-4">{invoice.project_name}</td>
      <td className="py-2 pr-4">{invoice.milestone_title}</td>
      {isAdmin && <td className="py-2 pr-4">{invoice.org_name}</td>}
      <td className="py-2 pr-4">
        {isAdmin ? (
          <input
            value={amount}
            disabled={pending}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          />
        ) : (
          `$${(invoice.amount_cents / 100).toFixed(2)}`
        )}
      </td>
      <td className="py-2 pr-4">
        {isAdmin ? (
          <select
            value={status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
            {invoice.status}
          </span>
        )}
      </td>
      <td className="py-2">
        {isAdmin && (
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={save}
            className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}
