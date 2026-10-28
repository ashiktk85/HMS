import Link from "next/link";
import {
  PageHeader,
  Panel,
  StatusPill,
  EmptyState,
  inputCls,
  btnSoft,
  roomStatusTone,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import {
  ROOM_CATEGORY_LABELS,
  ROOM_STATUSES,
  formatMoney,
  labelize,
  type RoomCategory,
} from "@/lib/types";
import { updateRoomStatus } from "./actions";
import { AddRoomSheet } from "./AddRoomSheet";

export default async function RoomsPage() {
  const supabase = await createClient();
  const { data: rooms } = await supabase.from("rooms").select("*").order("room_number");
  const counts = ROOM_STATUSES.map((s) => ({
    status: s,
    n: (rooms || []).filter((r) => r.is_active && r.status === s).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rooms"
        description="Regular and driver rooms, rates, and live status with history."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {counts.map((c) => (
          <Panel key={c.status} className="!p-3">
            <p className="text-xs text-[var(--muted)]">{labelize(c.status)}</p>
            <p className="mt-1 text-xl font-semibold">{c.n}</p>
          </Panel>
        ))}
      </div>

      <Panel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-semibold">All rooms</h3>
          <AddRoomSheet />
        </div>
        {!rooms?.length ? (
          <EmptyState message="No rooms yet. Use Add room." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Room</th>
                  <th className="font-medium">Category</th>
                  <th className="font-medium">Rate</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => {
                  return (
                    <tr
                      key={room.id}
                      className={`border-t border-[var(--line)] ${room.is_active ? "" : "opacity-50"}`}
                    >
                      <td className="py-3">
                        <Link className="font-medium text-[var(--brand)] hover:underline" href={`/rooms/${room.id}`}>
                          {room.room_number}
                        </Link>
                        {!room.is_active ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">inactive</span>
                        ) : null}
                      </td>
                      <td>{ROOM_CATEGORY_LABELS[room.category as RoomCategory]}</td>
                      <td>{formatMoney(room.base_rate)}</td>
                      <td>
                        <StatusPill tone={roomStatusTone(room.status)}>{labelize(room.status)}</StatusPill>
                      </td>
                      <td>
                        <ActionForm action={updateRoomStatus} className="flex flex-wrap items-center gap-2" successMessage="Updated">
                          <input type="hidden" name="room_id" value={room.id} />
                          <select name="status" defaultValue={room.status} aria-label={`Status for room ${room.room_number}`} className={`${inputCls} !w-auto !py-1 text-xs`}>
                            {ROOM_STATUSES.map((s) => (
                              <option key={s} value={s}>{labelize(s)}</option>
                            ))}
                          </select>
                          <SubmitButton className={`${btnSoft} !py-1 text-xs`} pendingLabel="…">
                            Update
                          </SubmitButton>
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
