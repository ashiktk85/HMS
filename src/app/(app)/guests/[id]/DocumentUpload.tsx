"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/ActionForm";
import { btnPrimary } from "@/components/ui";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Drag-and-drop uploader for guest ID documents. */
export function DocumentUpload({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Free the preview's object URL when it is replaced or the component goes away.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!TYPES.includes(f.type)) return setProblem("Only PDF, JPG, PNG or WebP files are allowed.");
    if (f.size > MAX_BYTES) return setProblem("That file is larger than 5 MB.");
    setProblem(null);
    const dt = new DataTransfer();
    dt.items.add(f);
    if (inputRef.current) inputRef.current.files = dt.files;
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setFile(null);
    setPreview(null);
    setProblem(null);
  }

  return (
    <ActionForm action={action} resetOnSuccess successMessage="Document uploaded" onSuccess={clear} className="space-y-3">
      <input
        ref={inputRef}
        id="guest-doc-file"
        type="file"
        name="file"
        required
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {!file ? (
        <label
          htmlFor="guest-doc-file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragging
              ? "border-[var(--brand)] bg-[var(--brand-tint)]"
              : "border-[var(--line)] bg-[var(--bg)] hover:border-[var(--brand)] hover:bg-[var(--brand-tint)]"
          }`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
              <path d="M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </span>
          <span className="text-sm font-medium text-[var(--ink)]">
            <span className="text-[var(--brand)]">Click to upload</span> or drag and drop
          </span>
          <span className="text-xs text-[var(--muted)]">Aadhaar, passport, licence · PDF, JPG, PNG or WebP · up to 5 MB</span>
        </label>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[0_1px_2px_rgba(16,24,16,0.04)]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-[var(--line)] object-cover" />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-xs font-semibold text-rose-700">PDF</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-[var(--muted)]">{size(file.size)} · ready to upload</p>
          </div>
          <button type="button" onClick={clear} className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted)] hover:bg-rose-50 hover:text-rose-700">
            Remove
          </button>
        </div>
      )}

      {problem ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {problem}
        </p>
      ) : null}

      <SubmitButton className={`${btnPrimary} w-full sm:w-auto`} pendingLabel="Uploading…">
        Upload document
      </SubmitButton>
    </ActionForm>
  );
}
