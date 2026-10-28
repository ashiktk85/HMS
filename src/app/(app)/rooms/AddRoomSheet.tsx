"use client";

import { useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, inputCls, btnPrimary, btnSoft } from "@/components/ui";
import { ROOM_CATEGORIES, ROOM_CATEGORY_LABELS } from "@/lib/types";
import { createRoom } from "./actions";

/** "Add room" button that opens the create form in a sheet sliding in from the right. */
export function AddRoomSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
        + Add room
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Add room"
            className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-[var(--panel)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add room</h3>
              <button type="button" onClick={() => setOpen(false)} className={`${btnSoft} !py-1`}>
                Close
              </button>
            </div>
            <ActionForm
              action={createRoom}
              resetOnSuccess
              successMessage="Room created"
              onSuccess={() => setOpen(false)}
              className="grid gap-3"
            >
              <Field label="Room number" hint="The number on the door, e.g. 101 (must be unique)">
                <input name="room_number" placeholder="101" required autoFocus className={inputCls} />
              </Field>
              <Field label="Room category" hint="Regular rooms are for customers">
                <select name="category" defaultValue="regular" className={inputCls}>
                  {ROOM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{ROOM_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Rate per night (₹)" hint="Default price, can be changed per booking">
                <input name="base_rate" type="number" min="0" step="0.01" placeholder="1500" className={inputCls} />
              </Field>
              <Field label="Max guests">
                <input name="max_occupancy" type="number" min="1" defaultValue={2} className={inputCls} />
              </Field>
              <Field label="Floor (optional)">
                <input name="floor" placeholder="1" className={inputCls} />
              </Field>
              <Field label="Notes (optional)">
                <input name="notes" placeholder="Near lift" className={inputCls} />
              </Field>
              <SubmitButton className={btnPrimary} pendingLabel="Creating…">Create room</SubmitButton>
            </ActionForm>
          </aside>
        </div>
      ) : null}
    </>
  );
}
