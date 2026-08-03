// Fires from the invoices_notify_on_insert trigger (pg_net), after a
// milestone is approved and generate_invoice_on_milestone_approval() has
// created the draft invoice. Looks up who to email and sends it via Resend.
//
// verify_jwt is off for this function (see supabase/config.toml) because the
// caller is Postgres, not a logged-in user. The x-internal-secret header is
// the only gate -- see the comment on notify_invoice_created() in the
// migration for why that's an acceptable tradeoff here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_WEBHOOK_SECRET")!;

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-internal-secret") !== INTERNAL_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const { invoice_id, milestone_id, project_id, org_id, amount_cents } = await req.json();

  const [milestoneRes, projectRes, orgRes, clientsRes] = await Promise.all([
    rest(`/milestones?id=eq.${milestone_id}&select=title`),
    rest(`/projects?id=eq.${project_id}&select=name`),
    rest(`/organizations?id=eq.${org_id}&select=name`),
    rest(`/profiles?org_id=eq.${org_id}&role=eq.client&select=id`),
  ]);

  const [milestone] = await milestoneRes.json();
  const [project] = await projectRes.json();
  const [org] = await orgRes.json();
  const clientProfiles: { id: string }[] = await clientsRes.json();

  const emails: string[] = [];
  for (const { id } of clientProfiles) {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (userRes.ok) {
      const user = await userRes.json();
      if (user.email) emails.push(user.email);
    }
  }

  if (emails.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "no client emails found for org" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const amount = (amount_cents / 100).toFixed(2);
  const results = await Promise.all(
    emails.map(async (to) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Client Portal <onboarding@resend.dev>",
          to,
          subject: `Invoice for ${project?.name ?? "your project"} -- milestone approved`,
          html: `<p>The milestone <strong>${milestone?.title ?? milestone_id}</strong> on project <strong>${project?.name ?? ""}</strong> was approved.</p>
                 <p>A draft invoice for $${amount} has been created for ${org?.name ?? "your organization"}.</p>`,
        }),
      });

      if (!res.ok) {
        const error = await res.text();
        console.error(`Resend send to ${to} failed (${res.status}): ${error}`);
        return { to, ok: false, status: res.status, error };
      }
      return { to, ok: true };
    })
  );

  const sent = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok);
  return new Response(
    JSON.stringify({ sent, of: emails.length, ...(errors.length > 0 ? { errors } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
