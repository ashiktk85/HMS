"use client";

import { useEffect, useState } from "react";

type Kind = "success" | "error";
type Toast = { id: number; message: string; kind: Kind };
type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/** Show a toast from anywhere on the client. Needs <Toaster /> mounted once (root layout). */
export function toast(message: string, kind: Kind = "success") {
  const t = { id: nextId++, message, kind };
  listeners.forEach((l) => l(t));
}

const DURATION_MS = 4000;

const LOOK: Record<Kind, { title: string; icon: string; badge: string; bar: string }> = {
  success: {
    title: "Success",
    icon: "M5 13l4 4L19 7",
    badge: "bg-emerald-100 text-emerald-700",
    bar: "bg-emerald-500",
  },
  error: {
    title: "Something went wrong",
    icon: "M6 6l12 12M18 6L6 18",
    badge: "bg-rose-100 text-rose-700",
    bar: "bg-rose-500",
  },
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast: Listener = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), DURATION_MS);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-3 px-4 sm:inset-x-auto sm:right-6 sm:top-6 sm:items-end"
    >
      {items.map((t) => {
        const look = LOOK[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className="toast-in pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_12px_32px_-8px_rgba(16,24,16,0.25)]"
          >
            <div className="flex items-start gap-3 p-4 pr-3">
              <span className={`toast-pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${look.badge}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                  <path d={look.icon} />
                </svg>
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-semibold text-[var(--ink)]">{t.kind === "success" ? t.message : look.title}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {t.kind === "success" ? "Your changes have been saved." : t.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-black/5 hover:text-[var(--ink)]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <span className={`toast-timer absolute bottom-0 left-0 h-1 w-full ${look.bar}`} style={{ animationDuration: `${DURATION_MS}ms` }} />
          </div>
        );
      })}
    </div>
  );
}
