"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { ok?: boolean; error?: string } | null | void;

/**
 * Form wrapper for server actions that return `{ ok } | { error }`.
 * Shows the error or a success note instead of silently ignoring the result.
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
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => action(formData),
    null,
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
    // onSuccess is intentionally not a dependency: callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess]);

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
      {state && "ok" in state && state.ok ? (
        <p className="rounded-xl bg-[var(--brand-tint)] px-3 py-2 text-sm text-[var(--brand)] sm:col-span-2 md:col-span-2">
          {successMessage}
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
