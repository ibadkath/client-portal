import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

// Used in Server Components, Server Actions, and Route Handlers. Server
// Components can't set cookies, so the setAll() call there is wrapped in a
// try/catch -- the proxy is what actually refreshes the session cookie on
// every request, this client just needs to read it.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component -- ignore, the proxy handles it.
          }
        },
      },
    }
  );
}
