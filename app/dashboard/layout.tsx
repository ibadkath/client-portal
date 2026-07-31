import Link from "next/link";
import { getProfile } from "@/lib/dal";
import { logout } from "@/app/actions/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10">
        <Link href="/dashboard" className="font-semibold">
          Client Portal
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard/invoices" className="underline underline-offset-2">
            Invoices
          </Link>
          {profile.role === "admin" && (
            <Link href="/dashboard/admin/users" className="underline underline-offset-2">
              Users
            </Link>
          )}
          <span className="text-black/60 dark:text-white/60">
            {profile.full_name ?? "—"} · {profile.role}
          </span>
          <form action={logout}>
            <button type="submit" className="underline underline-offset-2">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
