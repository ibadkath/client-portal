import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Memoized per-request: every Server Component on a page can call this
// without triggering duplicate round trips to Supabase.
export const getProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, org_id, full_name")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // A session with no matching profile row is invalid state (e.g. the
    // signup trigger's profile insert never landed). Leaving the session
    // cookie in place here would bounce right back to /dashboard via the
    // proxy's "logged-in users skip /login" rule -- an infinite redirect
    // loop. Signing out first breaks that loop.
    await supabase.auth.signOut();
    redirect("/login");
  }

  return profile;
});
