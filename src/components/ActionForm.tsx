"use client";

import { useActionState, useLayoutEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "./Toaster";

export type ActionResult = { ok?: boolean; error?: string } | null | void;

/**
 * React clears a form after every action, even a failed one. Put the submitted
 * values back so users don't have to retype everything after an error.
 */
export function restoreFormValues(form: HTMLFormElement, data: FormData) {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name) continue;
    if (el instanceof HTMLInputElement) {
      if (["hidden", "submit", "button", "reset", "image"].includes(el.type)) continue;
      if (el.type === "checkbox" || el.type === "radio") {
        el.checked = data.getAll(el.name).includes(el.value);
        continue;
      }
      if (el.type === "file") {
        const files = data.getAll(el.name).filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length) {
          const dt = new DataTransfer();
          files.forEach((f) => dt.items.add(f));
          el.files = dt.files;
        }
        continue;
      }
    }
    if (el instanceof HTMLSelectElement && el.multiple) {
      const picked = data.getAll(el.name);
      for (const o of Array.from(el.options)) o.selected = picked.includes(o.value);
      continue;
    }
    const v = data.get(el.name);
    if (typeof v === "string") el.value = v;
  }
}

/**
 * Form wrapper for server actions that return `{ ok } | { error }`.
 * Errors show inline and keep what the user typed. Success shows a toast and
 * clears the form when `resetOnSuccess` is set (create forms); edit forms keep their values.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  successMessage = "Saved",
  onSuccess,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  onSuccess?: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const submitted = useRef<FormData | null>(null);
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => {
    submitted.current = formData;
    return action(formData);
  }, null);

  useLayoutEffect(() => {
    if (!state) return;
    const ok = "ok" in state && state.ok;
    const failed = "error" in state && !!state.error;
    if (!ok && !failed) return;

    const form = ref.current;
    const data = submitted.current;
    // Keep values after an error, and after saving an edit form.
    const keep = failed || !resetOnSuccess;
    if (form && data && keep) {
      restoreFormValues(form, data);
      // React's own post-action reset can land a tick later; restore again to be safe.
      const t = setTimeout(() => restoreFormValues(form, data), 0);
      if (ok) {
        toast(successMessage);
        onSuccess?.();
      }
      return () => clearTimeout(t);
    }
    if (ok) {
      form?.reset();
      toast(successMessage);
      onSuccess?.();
    }
    // onSuccess is intentionally not a dependency: callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state && "error" in state && state.error ? (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-2 md:col-span-2"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  className,
  pendingLabel = "Saving…",
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
