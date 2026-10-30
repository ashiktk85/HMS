"use client";

import { PageHeader, Panel, inputCls, btnPrimary, mobileProps } from "@/components/ui";
import { restoreFormValues } from "@/components/ActionForm";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { createGuest, type DuplicateGuest } from "../actions";

const FIELDS: [name: string, label: string, required?: boolean][] = [
  ["full_name", "Full name", true],
  ["mobile", "Mobile"],
  ["email", "Email"],
  ["address", "Address"],
  ["nationality", "Nationality"],
  ["id_type", "ID type (e.g. Aadhaar, Passport)"],
  ["id_number", "ID number"],
  ["gstin", "Guest GSTIN"],
];

export default function NewGuestPage() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateGuest[]>([]);
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef<FormData | null>(null);

  // The form is cleared after every submit; put the typed values back when it failed.
  useLayoutEffect(() => {
    const form = formRef.current;
    const data = submitted.current;
    if (!failures || !form || !data) return;
    restoreFormValues(form, data);
    const t = setTimeout(() => restoreFormValues(form, data), 0);
    return () => clearTimeout(t);
  }, [failures]);

  function submit(formData: FormData, force = false) {
    if (force) formData.set("force", "1");
    submitted.current = formData;
    setError(null);
    start(async () => {
      // On success the action redirects; only failures come back here.
      const res = await createGuest(formData);
      if (res && "error" in res) {
        if (res.error === "duplicate" && "duplicates" in res) {
          setDupes(res.duplicates);
          setError("A guest with this mobile or email already exists. Open them below, or create anyway.");
        } else {
          setDupes([]);
          setError(String(res.error));
        }
        setFailures((n) => n + 1);
      }
    });
  }

  return (
    <div>
      <PageHeader
        title="New guest"
        actions={
          <Link href="/guests" className="text-sm font-medium text-[var(--brand)] hover:underline">
            Back
          </Link>
        }
      />
      <Panel>
        <form ref={formRef} action={(fd) => submit(fd, false)} className="grid gap-3 md:grid-cols-2">
          {FIELDS.map(([name, label, required]) => (
            <label key={name} className="text-sm">
              <span className="text-[var(--muted)]">{label}</span>
              <input
                name={name}
                required={!!required}
                defaultValue={name === "nationality" ? "Indian" : ""}
                className={`${inputCls} mt-1`}
                {...(name === "mobile" ? mobileProps : {})}
                {...(name === "mobile"
                  ? {
                      onInput: (e: React.FormEvent<HTMLInputElement>) => {
                        e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "").slice(0, 10);
                      },
                    }
                  : {})}
              />
            </label>
          ))}
          <label className="text-sm md:col-span-2">
            <span className="text-[var(--muted)]">Notes</span>
            <textarea name="notes" className={`${inputCls} mt-1`} rows={3} />
          </label>
          {error ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 md:col-span-2">
              {error}
            </p>
          ) : null}
          {dupes.length > 0 ? (
            <div className="space-y-2 text-sm md:col-span-2">
              {dupes.map((d) => (
                <Link key={d.id} href={`/guests/${d.id}`} className="block text-[var(--brand)] hover:underline">
                  {d.full_name} · {d.mobile || "—"} · {d.email || "—"}
                </Link>
              ))}
              <button
                type="submit"
                formAction={(fd) => submit(fd, true)}
                className="rounded-xl border border-[var(--line)] px-3 py-2"
              >
                Create anyway
              </button>
            </div>
          ) : null}
          <button type="submit" disabled={pending} className={`${btnPrimary} md:col-span-2`}>
            {pending ? "Saving…" : "Create guest"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
