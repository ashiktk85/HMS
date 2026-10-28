"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, inputCls, btnPrimary, btnSoft } from "@/components/ui";
import { addDays, diffDays, isDateString } from "@/lib/dates";
import { ROOM_CATEGORIES, ROOM_CATEGORY_LABELS, formatDate, labelize, type RoomCategory } from "@/lib/types";
import { createBooking } from "../actions";

const STATE_STYLE: Record<RoomState, { label: string; card: string; badge: string; dot: string }> = {
  available: {
    label: "Available",
    card: "border-emerald-300 bg-emerald-50 hover:border-emerald-500",
    badge: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
  },
  booked: {
    label: "Booked",
    card: "border-blue-200 bg-blue-50",
    badge: "bg-blue-600 text-white",
    dot: "bg-blue-500",
  },
  hold: {
    label: "On hold",
    card: "border-amber-300 bg-amber-50",
    badge: "bg-amber-500 text-white",
    dot: "bg-amber-500",
  },
  occupied: {
    label: "Occupied",
    card: "border-rose-200 bg-rose-50",
    badge: "bg-rose-600 text-white",
    dot: "bg-rose-500",
  },
  maintenance: {
    label: "Maintenance",
    card: "border-stone-300 bg-stone-100",
    badge: "bg-stone-500 text-white",
    dot: "bg-stone-400",
  },
  blocked: {
    label: "Blocked",
    card: "border-stone-300 bg-stone-100",
    badge: "bg-stone-700 text-white",
    dot: "bg-stone-600",
  },
};
const STATE_ORDER: RoomState[] = ["available", "booked", "hold", "occupied", "maintenance", "blocked"];

export type RoomState = "available" | "booked" | "hold" | "occupied" | "maintenance" | "blocked";
export type Stay = { status: string; from: string; to: string; guest: string };
export type RoomInfo = {
  id: string;
  room_number: string;
  category: RoomCategory;
  floor: string | null;
  status: string;
  base_rate: number;
  max_occupancy: number;
  /** Hold / confirmed / checked-in bookings that have not ended yet, oldest first. */
  stays: Stay[];
};
export type RoomOption = Omit<RoomInfo, "stays" | "status"> & {
  state: RoomState;
  /** Only available rooms can be picked. */
  selectable: boolean;
  /** Who has it / what is next. */
  detail: string;
  /** When it frees up, or a heads-up. */
  note?: string;
};
export type GuestOption = { id: string; full_name: string; mobile: string | null };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const cents = (n: number) => Math.round(n * 100) / 100;

/** What a room looks like for the stay [checkIn, checkOut). */
function describeRoom(r: RoomInfo, checkIn: string, checkOut: string, today: string): RoomOption {
  const base = {
    id: r.id,
    room_number: r.room_number,
    category: r.category,
    floor: r.floor,
    base_rate: r.base_rate,
    max_occupancy: r.max_occupancy,
  };
  if (r.status === "maintenance" || r.status === "blocked") {
    return {
      ...base,
      state: r.status,
      selectable: false,
      detail: r.status === "maintenance" ? "Under maintenance" : "Blocked by management",
      note: "Change its status on the Rooms page to book it",
    };
  }
  const stays = r.stays;
  const clash = stays.find((x) => x.from < checkOut && x.to > checkIn);
  if (clash) {
    // Follow back-to-back bookings to find the first day the room is really free.
    let freeFrom = clash.to;
    for (let i = 0; i < stays.length; i++) {
      const next = stays.find((x) => x.from <= freeFrom && x.to > freeFrom);
      if (!next) break;
      freeFrom = next.to;
    }
    const state: RoomState =
      clash.status === "checked_in" ? "occupied" : clash.status === "hold" ? "hold" : "booked";
    const detail =
      state === "occupied"
        ? `In use by ${clash.guest}, checks out ${formatDate(clash.to)}`
        : state === "hold"
          ? `On hold for ${clash.guest} (${formatDate(clash.from)} → ${formatDate(clash.to)})`
          : `Booked by ${clash.guest} (${formatDate(clash.from)} → ${formatDate(clash.to)})`;
    return { ...base, state, selectable: false, detail, note: `Available from ${formatDate(freeFrom)}` };
  }
  const next = stays.find((x) => x.from >= checkOut);
  const detail = next
    ? `Free until ${formatDate(next.from)} (next: ${next.guest})`
    : "No upcoming bookings";
  const note =
    checkIn === today && ["dirty", "cleaning", "inspection"].includes(r.status)
      ? `Being made ready now (${labelize(r.status).toLowerCase()})`
      : checkIn === today && r.status === "occupied"
        ? "Marked occupied right now, check before booking"
        : undefined;
  return { ...base, state: "available", selectable: true, detail, note };
}

export function BookingForm({
  guests,
  rooms: roomInfos,
  today,
  defaultCheckIn,
  defaultCheckOut,
  defaultGuestId,
  defaultRoomId,
}: {
  guests: GuestOption[];
  rooms: RoomInfo[];
  today: string;
  defaultCheckIn: string;
  defaultCheckOut: string;
  defaultGuestId?: string;
  defaultRoomId?: string;
}) {
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const datesOk = isDateString(checkIn) && isDateString(checkOut) && diffDays(checkIn, checkOut) >= 1;
  const nights = datesOk ? diffDays(checkIn, checkOut) : 1;
  // The cards always show; with unusable dates they are described for tonight.
  const rooms = roomInfos.map((r) =>
    datesOk ? describeRoom(r, checkIn, checkOut, today) : describeRoom(r, today, addDays(today, 1), today),
  );

  const initialRoom = rooms.find((r) => r.id === defaultRoomId && r.selectable) ?? null;
  const [roomId, setRoomId] = useState(initialRoom?.id ?? "");
  const [open, setOpen] = useState(!!initialRoom);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const [rate, setRate] = useState(initialRoom ? String(initialRoom.base_rate) : "");
  const [discount, setDiscount] = useState("0");
  const [extraBed, setExtraBed] = useState("0");
  const [additional, setAdditional] = useState("0");
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");

  const room = rooms.find((r) => r.id === roomId);
  const roomTotal = cents(Number(rate || 0) * nights);
  const total = Math.max(
    cents(roomTotal + Number(extraBed || 0) + Number(additional || 0) - Number(discount || 0)),
    0,
  );
  const guestCount = Number(adults || 0) + Number(children || 0);
  const overCapacity = room && guestCount > room.max_occupancy;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Check-in">
          <input type="date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Check-out" hint={datesOk ? `${nights} night${nights === 1 ? "" : "s"}` : "Check-out must be after check-in"}>
          <input type="date" min={addDays(checkIn || today, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-2 text-xs text-[var(--muted)]">
          {STATE_ORDER.filter((st) => rooms.some((r) => r.state === st)).map((st) => (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${STATE_STYLE[st].dot}`} />
              {STATE_STYLE[st].label} ({rooms.filter((r) => r.state === st).length})
            </span>
          ))}
        </div>
      </div>

      {rooms.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted)]">No rooms yet. Add rooms on the Rooms page.</p>
      ) : null}
      {ROOM_CATEGORIES.map((cat) => {
        const group = rooms.filter((r) => r.category === cat);
        if (!group.length) return null;
        return (
          <section key={cat} className="mt-6">
            <h3 className="mb-3 font-semibold">
              {ROOM_CATEGORY_LABELS[cat]}s{" "}
              <span className="text-sm font-normal text-[var(--muted)]">
                · {group.filter((r) => r.selectable).length} of {group.length} free
              </span>
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.map((r) => {
                const st = STATE_STYLE[r.state];
                const body = (
                  <>
                    <span className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block text-2xl font-bold leading-none">{r.room_number}</span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          {r.floor ? `Floor ${r.floor} · ` : ""}up to {r.max_occupancy} guests
                        </span>
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.badge}`}>{st.label}</span>
                    </span>
                    <span className="mt-3 block text-sm leading-snug">{r.detail}</span>
                    {r.note ? <span className="mt-1 block text-xs font-semibold">{r.note}</span> : null}
                    <span className="mt-3 flex items-center justify-between border-t border-black/10 pt-2 text-sm">
                      <span className="font-semibold">{inr.format(r.base_rate)}<span className="font-normal text-[var(--muted)]"> / night</span></span>
                      {r.selectable ? <span className="font-semibold text-[var(--brand)]">Book →</span> : null}
                    </span>
                  </>
                );
                const cls = `block rounded-2xl border-2 p-4 text-left ${st.card}`;
                return r.selectable ? (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRoomId(r.id);
                      setRate(String(r.base_rate));
                      setOpen(true);
                    }}
                    className={`${cls} cursor-pointer shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={r.id} className={cls}>{body}</div>
                );
              })}
            </div>
          </section>
        );
      })}

      {open && room ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Book room ${room.room_number}`}
            className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-[var(--panel)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Book room {room.room_number}</h3>
                <p className="text-sm text-[var(--muted)]">
                  {ROOM_CATEGORY_LABELS[room.category]} · {formatDate(checkIn)} → {formatDate(checkOut)} · {nights} night{nights === 1 ? "" : "s"}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className={`${btnSoft} !py-1`}>Close</button>
            </div>
            <ActionForm action={createBooking} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="room_id" value={roomId} />
              <input type="hidden" name="check_in_date" value={checkIn} />
              <input type="hidden" name="check_out_date" value={checkOut} />

        <Field
          label="Guest"
          hint={
            <>
              Not listed?{" "}
              <Link href="/guests/new" className="font-medium text-[var(--brand)] hover:underline">
                Create the guest first
              </Link>
            </>
          }
        >
          <select name="guest_id" required defaultValue={defaultGuestId ?? ""} className={inputCls}>
            <option value="">Select guest</option>
            {guests.map((g) => (
              <option key={g.id} value={g.id}>
                {g.full_name} {g.mobile ? `(${g.mobile})` : ""}
              </option>
            ))}
          </select>
        </Field>
  
        <Field label="AC or Non-AC" hint="Choose Non-AC if the guest does not want the AC; it is switched off for the stay">
          <select name="ac_option" defaultValue="ac" className={inputCls}>
            <option value="ac">AC</option>
            <option value="non_ac">Non-AC (switch AC off)</option>
          </select>
        </Field>

        <Field label="Booking source">
          <select name="source" defaultValue="direct" className={inputCls}>
            <option value="direct">Direct</option>
            <option value="walk_in">Walk-in</option>
            <option value="phone">Phone</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </Field>

        <Field
          label="Booking status"
          hint="Enquiry and Hold are tentative. Confirm once an advance is received."
        >
          <select name="status" defaultValue="confirmed" className={inputCls}>
            <option value="enquiry">Enquiry (not held, can be taken by others)</option>
            <option value="hold">Hold (room is held for this guest)</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </Field>

        <Field label="Room rate per night (₹)" hint="Filled from the room; change for special rates">
          <input
            type="number"
            name="room_rate"
            min="0"
            step="0.01"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Discount (₹, total)" hint="Taken off the whole stay">
          <input type="number" name="discount_amount" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Extra bed charge (₹, total)">
          <input type="number" name="extra_bed_charge" min="0" step="0.01" value={extraBed} onChange={(e) => setExtraBed(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Additional charges (₹, total)" hint="Anything else billed upfront">
          <input type="number" name="additional_charges" min="0" step="0.01" value={additional} onChange={(e) => setAdditional(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Adults">
          <input type="number" name="adults" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Children">
          <input type="number" name="children" min="0" value={children} onChange={(e) => setChildren(e.target.value)} className={inputCls} />
        </Field>

        {overCapacity ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 md:col-span-2">
            This room fits {room.max_occupancy} guests. Add an extra bed charge if the extra guest is staying.
          </p>
        ) : null}

        <Field label="Notes (optional)" className="md:col-span-2">
          <textarea name="notes" rows={2} className={inputCls} />
        </Field>

        <div className="rounded-2xl bg-[var(--brand-tint)] p-4 md:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">
              {nights} night{nights === 1 ? "" : "s"} × {inr.format(Number(rate || 0))} = {inr.format(roomTotal)}
            </span>
            <span className="text-lg font-semibold">Total {inr.format(total)}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The final amount is calculated again on the server when you save.
          </p>
        </div>

        <SubmitButton className={`${btnPrimary} md:col-span-2`} pendingLabel="Creating booking…">
          Create booking
        </SubmitButton>
            </ActionForm>
          </aside>
        </div>
      ) : null}
    </>
  );
}
