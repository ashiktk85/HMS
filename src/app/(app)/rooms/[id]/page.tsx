import Link from "next/link";
import {
  PageHeader,
  Panel,
  StatusPill,
  EmptyState,
  inputCls,
  btnPrimary,
  roomStatusTone,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import {
  ROOM_CATEGORIES,
  ROOM_CATEGORY_LABELS,
  formatMoney,
  labelize,
  rel,
  type RoomCategory,
} from "@/lib/types";
import { notFound } from "next/navigation";
import { updateRoom } from "../actions";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!room) notFound();

  const { data: history } = await supabase
    .from("room_status_history")
    .select("*, profiles(full_name)")
    .eq("room_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Room ${room.room_number}`}
        description={`${ROOM_CATEGORY_LABELS[room.category as RoomCategory]} · ${formatMoney(room.base_rate)} / night`}
        actions={
          <Link href="/rooms" className="text-sm font-medium text-[var(--brand)] hover:underline">
            Back to rooms
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4 flex items-center gap-3">
            <StatusPill tone={roomStatusTone(room.status)}>{labelize(room.status)}</StatusPill>
            {!room.is_active ? <StatusPill tone="danger">Inactive</StatusPill> : null}
          </div>
          <ActionForm action={updateRoom} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={room.id} />
            <label className="text-sm">
              <span className="text-[var(--muted)]">Room number</span>
              <input name="room_number" defaultValue={room.room_number} required className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-[var(--muted)]">Category</span>
              <select name="category" defaultValue={room.category} className={`${inputCls} mt-1`}>
                {ROOM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{ROOM_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-[var(--muted)]">Rate per night (₹)</span>
              <input name="base_rate" type="number" min="0" step="0.01" defaultValue={room.base_rate} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-[var(--muted)]">Max guests</span>
              <input name="max_occupancy" type="number" min="1" defaultValue={room.max_occupancy} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-[var(--muted)]">Floor</span>
              <input name="floor" defaultValue={room.floor ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-[var(--muted)]">Notes</span>
              <input name="notes" defaultValue={room.notes ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="is_active" defaultChecked={room.is_active} />
              Active (inactive rooms are retired, not deleted)
            </label>
            <SubmitButton className={`${btnPrimary} sm:col-span-2`}>Save room</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel>
          <h3 className="mb-3 font-semibold">Status history</h3>
          {!history?.length ? (
            <EmptyState message="No status changes yet." />
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 py-2">
                  <span>
                    {h.from_status ? labelize(h.from_status) : "Created"} → {labelize(h.to_status)}
                    <span className="block text-xs text-[var(--muted)]">
                      {rel(h.profiles as { full_name: string } | null)?.full_name ?? "System"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {dateTime.format(new Date(h.created_at))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
