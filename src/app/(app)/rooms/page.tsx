import Link from "next/link";
import {
  PageHeader,
  Panel,
  StatusPill,
  EmptyState,
  inputCls,
  btnPrimary,
  btnSoft,
  roomStatusTone,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import {
  ROOM_CATEGORY_LABELS,
  ROOM_STATUSES,
  formatMoney,
  roomLabel,
  type RoomCategory,
} from "@/lib/types";
import { Stat, type IconName, type Tone } from "../dashboard/parts";
import { updateRoomStatus } from "./actions";
import { AddRoomSheet } from "./AddRoomSheet";

const STATUS_CARD: Record<string, { icon: IconName; tone: Tone }> = {
  available: { icon: "bed", tone: "green" },
  reserved: { icon: "clock", tone: "rose" },
  occupied: { icon: "users", tone: "sky" },
  dirty: { icon: "sparkle", tone: "amber" },
  cleaning: { icon: "sparkle", tone: "amber" },
  maintenance: { icon: "wrench", tone: "orange" },
};

export default async function RoomsPage() {
  const supabase = await createClient();
  const { data: rooms } = await supabase.from("rooms").select("*").order("room_number");
  const activeRooms = (rooms || []).filter((r) => r.is_active);
  const counts = ROOM_STATUSES.map((s) => ({
    status: s,
    n: activeRooms.filter((r) => r.status === s).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rooms"
        description="Regular and driver rooms, rates, and live status with history."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {counts.map((c) => {
          const look = STATUS_CARD[c.status];
          return (
            <Stat
              key={c.status}
              label={roomLabel(c.status)}
              value={String(c.n)}
              icon={look.icon}
              tone={look.tone}
              hint={`of ${activeRooms.length} room${activeRooms.length === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>

      <Panel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-semibold">All rooms</h3>
          <AddRoomSheet />
        </div>
        {!rooms?.length ? (
          <EmptyState message="No rooms yet. Use Add room." />
        ) : (
          <DataTable
            pageSize={50}
            searchPlaceholder="Search room number"
            columns={[
              { header: "Room" },
              { header: "Category" },
              { header: "Rate", align: "right" },
              { header: "Status" },
              { header: "Active" },
              { header: "Change status" },
            ]}
            filters={[
              {
                key: "status",
                label: "All statuses",
                options: ROOM_STATUSES.map((s) => ({ value: s, label: s === "available" ? "Available" : roomLabel(s) })),
              },
              {
                key: "category",
                label: "All categories",
                options: Object.entries(ROOM_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
              },
            ]}
            rows={rooms.map((room) => ({
              key: room.id,
              details: {
                title: `Room ${room.room_number}`,
                subtitle: `${ROOM_CATEGORY_LABELS[room.category as RoomCategory]} · ${roomLabel(room.status)}`,
                fields: [
                  { label: "Category", value: ROOM_CATEGORY_LABELS[room.category as RoomCategory] },
                  { label: "Status", value: roomLabel(room.status) },
                  { label: "Rate per night", value: formatMoney(room.base_rate) },
                  { label: "Max guests", value: String(room.max_occupancy ?? "") },
                  { label: "Floor", value: room.floor },
                  { label: "Active", value: room.is_active ? "Yes" : "No" },
                  { label: "Notes", value: room.notes, wide: true },
                ],
                actions: (
                  <>
                    <Link href={`/rooms/${room.id}`} className={btnPrimary}>Open room</Link>
                    <Link href={`/bookings/new?room_id=${room.id}`} className={btnSoft}>Book this room</Link>
                  </>
                ),
              },
              search: `${room.room_number} ${ROOM_CATEGORY_LABELS[room.category as RoomCategory]} ${roomLabel(room.status)}`,
              filter: { status: room.status, category: room.category },
              className: room.is_active ? "" : "opacity-50",
              cells: [
                <Link key="r" className="font-medium text-[var(--brand)] hover:underline" href={`/rooms/${room.id}`}>
                  {room.room_number}
                </Link>,
                ROOM_CATEGORY_LABELS[room.category as RoomCategory],
                formatMoney(room.base_rate),
                <StatusPill key="s" tone={roomStatusTone(room.status)}>{roomLabel(room.status)}</StatusPill>,
                room.is_active ? "Yes" : "No",
                <ActionForm key="c" action={updateRoomStatus} className="flex items-center gap-2" successMessage="Updated">
                  <input type="hidden" name="room_id" value={room.id} />
                  <select name="status" defaultValue={room.status} aria-label={`Status for room ${room.room_number}`} className={`${inputCls} !w-auto !py-0.5 text-xs`}>
                    {ROOM_STATUSES.map((s) => (
                      <option key={s} value={s}>{s === "available" ? "Available" : roomLabel(s)}</option>
                    ))}
                  </select>
                  <SubmitButton className={`${btnSoft} !py-0.5 text-xs`} pendingLabel="…">
                    Update
                  </SubmitButton>
                </ActionForm>,
              ],
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
