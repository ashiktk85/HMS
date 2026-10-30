"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

export type NavItem = { href: string; label: string; icon: IconName };

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
          : "flex-1 space-y-0.5 overflow-y-auto p-3"
      }
    >
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`group flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                : "text-[var(--muted)] hover:bg-[var(--brand-tint)] hover:text-[var(--ink)]"
            }`}
          >
            <Icon
              name={item.icon}
              className={`h-[18px] w-[18px] shrink-0 transition ${
                isActive ? "text-[var(--brand)]" : "text-[var(--muted)] group-hover:text-[var(--brand)]"
              }`}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
