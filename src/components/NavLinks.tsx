"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

export function NavLinks({
  items,
  horizontal = false,
}: {
  items: NavItem[];
  horizontal?: boolean;
}) {
  const pathname = usePathname();

  // The most specific matching href wins (e.g. /bookings/calendar over /bookings).
  const active = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      className={
        horizontal
          ? "flex gap-1 overflow-x-auto px-3 pb-3"
          : "flex-1 space-y-1 overflow-y-auto p-3"
      }
    >
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${
              horizontal ? "" : "block"
            } ${
              isActive
                ? "bg-[var(--brand-soft)] text-[var(--ink)]"
                : "text-[var(--muted)] hover:bg-[var(--brand-tint)] hover:text-[var(--ink)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
