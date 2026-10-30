"use client";

import { useEffect } from "react";
import { btnSoft } from "./ui";

/** Side sheet that slides in from the right. Wide by default; Escape or a click outside closes it. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width = "max-w-3xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Tailwind max-width class for the panel. */
  width?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet-in relative flex h-full w-full ${width} flex-col overflow-y-auto bg-[var(--panel)] shadow-xl`}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className={`${btnSoft} !py-1`}>
            Close
          </button>
        </div>
        <div className="flex-1 px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}
