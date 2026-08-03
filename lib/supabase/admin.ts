import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Service-role client. Bypasses RLS entirely -- only ever import this from
// Server Actions/Route Handlers that have already verified the caller is an
// admin. The `server-only` import makes accidentally pulling this into a
// Client Component a build error, not a runtime leak.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
