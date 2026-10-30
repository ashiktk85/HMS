"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Sheet } from "@/components/Sheet";
import { Field, inputCls, btnPrimary } from "@/components/ui";
import { ROOM_CATEGORIES, ROOM_CATEGORY_LABELS } from "@/lib/types";
import { createRoom } from "./actions";

/** "Add room" button that opens the create form in a sheet sliding in from the right. */
export function AddRoomSheet() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
        + Add room
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Add room" subtitle="New rooms start as available." width="max-w-2xl">
        <ActionForm
          action={createRoom}
          resetOnSuccess
          successMessage="Room created"
          onSuccess={() => setOpen(false)}
          className="grid gap-4 sm:grid-cols-2"
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
          <SubmitButton className={`${btnPrimary} sm:col-span-2`} pendingLabel="Creating…">Create room</SubmitButton>
        </ActionForm>
      </Sheet>
    </>
  );
}
