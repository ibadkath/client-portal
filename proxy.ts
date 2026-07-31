import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs on (almost) every request. Two jobs:
// 1. Refresh the Supabase auth cookie so Server Components always see a
//    valid session (Supabase access tokens are short-lived; only this layer
//    or the browser client can refresh them -- Server Components can't).
// 2. Optimistic redirect: bounce signed-out users away from /dashboard and
//    signed-in users away from /login, based on the cookie alone. This is
//    the "quick UX redirect" layer only -- every dashboard page and Server
//    Action still checks the real session itself, since Proxy is not a
//    substitute for per-request authorization.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isDashboardRoute = path.startsWith("/dashboard");
  const isLoginRoute = path === "/login";
  const isSignupRoute = path === "/signup";

  if (isDashboardRoute && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if ((isLoginRoute || isSignupRoute) && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
