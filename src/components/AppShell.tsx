import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { NavLinks, type NavItem } from "./NavLinks";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/rooms", label: "Rooms", icon: "bed" },
  { href: "/guests", label: "Guests", icon: "users" },
  { href: "/bookings", label: "Bookings", icon: "bookings" },
  { href: "/bookings/calendar", label: "Calendar", icon: "calendarDays" },
  { href: "/payments", label: "Payments", icon: "wallet" },
  { href: "/invoices", label: "Invoices", icon: "invoice" },
  { href: "/expenses", label: "Expenses", icon: "receipt" },
  { href: "/accounts", label: "Accounts", icon: "bank" },
  { href: "/accounts/pnl", label: "Profit & Loss", icon: "trend" },
  { href: "/housekeeping", label: "Housekeeping", icon: "sparkle" },
  { href: "/maintenance", label: "Maintenance", icon: "wrench" },
  { href: "/reports", label: "Reports", icon: "chart" },
  { href: "/audit", label: "Audit", icon: "shield" },
  { href: "/settings", label: "Settings", icon: "sliders" },
];

function initials(name: string) {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function AppShell({
  children,
  role,
  name,
  hotelName,
}: {
  children: React.ReactNode;
  role: AppRole;
  name: string;
  hotelName: string;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="flex min-h-screen">
        {/* Pinned to the viewport: only the main content scrolls; the nav scrolls itself if it is tall. */}
        <aside className="hidden w-64 shrink-0 border-r border-[var(--line)] bg-[var(--panel)] md:sticky md:top-0 md:flex md:h-screen md:flex-col">
          <div className="flex items-center gap-3 px-5 py-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand)]">
              {initials(hotelName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">
                {hotelName}
              </p>
              <p className="text-xs text-[var(--muted)]">Hotel Cloud</p>
            </div>
          </div>
          <NavLinks items={NAV} />
          <div className="border-t border-[var(--line)] p-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
                {initials(name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {ROLE_LABELS[role]}
                </p>
              </div>
            </div>
            <form action="/auth/signout" method="post" className="mt-3">
              <button
                type="submit"
                className="text-xs font-medium text-[var(--brand)] underline-offset-2 hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--panel)] md:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-lg font-semibold text-[var(--brand)]">
                {hotelName}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {ROLE_LABELS[role]}
              </span>
            </div>
            <NavLinks items={NAV} horizontal />
          </header>
          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
