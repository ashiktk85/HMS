import Link from "next/link";
import {
  PageHeader,
  Panel,
  StatusPill,
  EmptyState,
  Field,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { readyRooms } from "@/lib/availability";
import { todayLocal } from "@/lib/dates";
import {
  BOOKING_TRANSITIONS,
  bookingTone,
  formatDate,
  formatMoney,
  labelize,
  rel,
  AC_LABELS,
  ROOM_CATEGORY_LABELS,
  type AcOption,
  type BookingStatus,
  type RoomCategory,
} from "@/lib/types";
import { notFound } from "next/navigation";
import {
  addFolioCharge,
  changeRoom,
  checkInBooking,
  checkOutBooking,
  updateBookingStatus,
  voidFolioCharge,
} from "../actions";
import { FolioForm } from "./FolioForm";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("*, guests(*), rooms(id, room_number, status, category)")
    .eq("id", id)
    .maybeSingle();
  if (!booking) notFound();

  const today = todayLocal();
  const status = booking.status as BookingStatus;

  const [
    { data: history },
    { data: folio },
    { data: payments },
    { data: services },
    { data: checkIn },
    { data: checkOut },
    checkInRooms,
    moveRooms,
  ] = await Promise.all([
    supabase
      .from("booking_status_history")
      .select("*, profiles(full_name)")
      .eq("booking_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("folio_charges")
      .select("*")
      .eq("booking_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("*")
      .eq("booking_id", id)
      .order("received_at", { ascending: false }),
    supabase.from("service_items").select("*").eq("is_active", true).order("name"),
    supabase.from("check_ins").select("*").eq("booking_id", id).maybeSingle(),
    supabase.from("check_outs").select("*").eq("booking_id", id).maybeSingle(),
    ["confirmed", "hold"].includes(status)
      ? readyRooms(supabase, booking.check_in_date, booking.check_out_date, id)
      : Promise.resolve([]),
    status === "checked_in"
      ? readyRooms(supabase, today, booking.check_out_date, id)
      : Promise.resolve([]),
  ]);

  const { data: activeInvoice } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_type, status")
    .eq("booking_id", id)
    .in("status", ["issued", "credited"])
    .maybeSingle();

  async function setStatus(formData: FormData) {
    "use server";
    formData.set("booking_id", id);
    return updateBookingStatus(formData);
  }
  async function doCheckIn(formData: FormData) {
    "use server";
    formData.set("booking_id", id);
    return checkInBooking(formData);
  }
  async function doChangeRoom(formData: FormData) {
    "use server";
    formData.set("booking_id", id);
    return changeRoom(formData);
  }
  async function addCharge(formData: FormData) {
    "use server";
    formData.set("booking_id", id);
    return addFolioCharge(formData);
  }
  async function doVoid(formData: FormData) {
    "use server";
    formData.set("booking_id", id);
    return voidFolioCharge(formData);
  }
  async function doCheckOut(formData: FormData) {
    "use server";
    formData.set("booking_id", id);
    return checkOutBooking(formData);
  }

  const guest = rel(
    booking.guests as
      | { id: string; full_name: string; mobile: string | null }
      | { id: string; full_name: string; mobile: string | null }[]
      | null,
  );
  const room = rel(
    booking.rooms as
      | { id: string; room_number: string; status: string; category: string }
      | { id: string; room_number: string; status: string; category: string }[]
      | null,
  );
  const roomType = room ? ROOM_CATEGORY_LABELS[room.category as RoomCategory] : undefined;
  const nextStatuses = BOOKING_TRANSITIONS[status] ?? [];
  const hasPayments = Number(booking.amount_paid) > 0;
  const due = Number(booking.balance_due);
  const originalReady = checkInRooms.some((r) => r.id === booking.room_id);
  const activeFolio = (folio || []).filter((f) => !f.voided);
  const voidedFolio = (folio || []).filter((f) => f.voided);

  return (
    <div className="space-y-6">
      <PageHeader
        title={booking.booking_code}
        description={`${guest?.full_name} · Room ${room?.room_number}${roomType ? ` (${roomType})` : ""} · ${AC_LABELS[booking.ac_option as AcOption] ?? "AC"}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/payments/new?booking_id=${id}`} className={btnSoft}>
              Add payment
            </Link>
            {activeInvoice ? (
              <Link href={`/invoices/${activeInvoice.id}`} className={btnPrimary}>
                Invoice {activeInvoice.invoice_number}
              </Link>
            ) : ["checked_in", "checked_out"].includes(status) ? (
              <Link href={`/invoices/new?booking_id=${id}`} className={btnPrimary}>
                Create invoice
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Total", formatMoney(booking.total_amount)],
          ["Paid", formatMoney(booking.amount_paid)],
          ["Due", formatMoney(booking.balance_due)],
        ].map(([k, v]) => (
          <Panel key={k as string}>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{k}</p>
            <p className="mt-1 text-xl font-semibold">{v}</p>
          </Panel>
        ))}
        <Panel>
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Status</p>
          <div className="mt-2">
            <StatusPill tone={bookingTone(status)}>{labelize(status)}</StatusPill>
          </div>
        </Panel>
      </div>

      {due > 0 && status === "checked_out" ? (
        <Panel className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            Outstanding balance: {formatMoney(booking.balance_due)} was left unpaid at check-out.{" "}
            <Link href={`/payments/new?booking_id=${id}`} className="font-medium underline">
              Record a payment
            </Link>
          </p>
        </Panel>
      ) : null}

      {/* ---------- Stay workflow ---------- */}
      {["confirmed", "hold"].includes(status) ? (
        <Panel className="border-[var(--brand-soft)]">
          <h3 className="mb-1 font-semibold">Check in</h3>
          {booking.check_in_date > today ? (
            <p className="text-sm text-[var(--muted)]">
              This guest is due on {formatDate(booking.check_in_date)}. Check-in opens on the arrival date.
            </p>
          ) : booking.check_out_date <= today ? (
            <p className="text-sm text-rose-700">
              The stay dates have passed ({formatDate(booking.check_out_date)}). Mark the booking as no-show or cancel it.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-[var(--muted)]">
                Stay {formatDate(booking.check_in_date)} → {formatDate(booking.check_out_date)}. Room status becomes
                Occupied.
              </p>
              {!originalReady ? (
                <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Room {room?.room_number} is {room?.status} right now, so it cannot be allocated. Choose another ready
                  room, or get this room cleaned first.
                </p>
              ) : null}
              {checkInRooms.length === 0 ? (
                <EmptyState message="No ready room is free for these dates." />
              ) : (
                <ActionForm action={doCheckIn} successMessage="Checked in" className="grid gap-3 text-sm md:grid-cols-2">
                  <Field label="Room allocation" hint="Only clean, free rooms are listed">
                    <select name="room_id" defaultValue={originalReady ? booking.room_id : ""} required className={inputCls}>
                      {!originalReady ? <option value="">Select a room</option> : null}
                      {checkInRooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.room_number} · {ROOM_CATEGORY_LABELS[r.category as RoomCategory]}
                          {r.id === booking.room_id ? " (booked room)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Additional guests" hint="People staying beyond those booked">
                    <input type="number" name="additional_guests" min="0" defaultValue={0} className={inputCls} />
                  </Field>
                  <label className="flex items-center gap-2 md:col-span-2">
                    <input type="checkbox" name="id_verified" required />
                    I have checked the guest&apos;s ID
                  </label>
                  <SubmitButton className={`${btnPrimary} md:col-span-2`}>Check in</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Panel>
      ) : null}

      {status === "checked_in" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <h3 className="mb-1 font-semibold">Change room</h3>
            <p className="mb-3 text-sm text-[var(--muted)]">
              In room {room?.room_number}
              {checkIn ? ` since ${formatDate(checkIn.checked_in_at)}` : ""}. The old room becomes Dirty and gets a
              cleaning task. The rate does not change; adjust the discount if needed.
            </p>
            {moveRooms.length === 0 ? (
              <EmptyState message="No other ready room is free until check-out." />
            ) : (
              <ActionForm action={doChangeRoom} successMessage="Room changed" className="grid gap-3">
                <Field label="Move to">
                  <select name="room_id" required defaultValue="" className={inputCls}>
                    <option value="">Select room</option>
                    {moveRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.room_number} · {ROOM_CATEGORY_LABELS[r.category as RoomCategory]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reason (optional)">
                  <input name="reason" placeholder="AC not working" className={inputCls} />
                </Field>
                <SubmitButton className={btnSoft}>Change room</SubmitButton>
              </ActionForm>
            )}
          </Panel>

          <Panel>
            <h3 className="mb-1 font-semibold">Check out</h3>
            <p className="mb-3 text-sm text-[var(--muted)]">
              Booked until {formatDate(booking.check_out_date)}
              {booking.check_out_date > today ? " (leaving early; the booked nights are still billed)" : ""}.
              The room becomes Dirty and a housekeeping task is created.
            </p>
            {!activeInvoice ? (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No invoice yet. Invoicing before check-out keeps the final bill and GST correct.{" "}
                <Link href={`/invoices/new?booking_id=${id}`} className="font-medium underline">
                  Create invoice
                </Link>
              </p>
            ) : null}
            <ActionForm action={doCheckOut} successMessage="Checked out" className="grid gap-3 text-sm">
              <div className="rounded-xl bg-[var(--brand-tint)] p-3">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Final bill</span>
                  <span className="font-semibold">{formatMoney(booking.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Paid</span>
                  <span>{formatMoney(booking.amount_paid)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Balance due</span>
                  <span className={due > 0 ? "font-semibold text-rose-700" : "font-semibold"}>{formatMoney(due)}</span>
                </div>
              </div>
              {due > 0 ? (
                <>
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
                    {formatMoney(due)} is still unpaid.{" "}
                    <Link href={`/payments/new?booking_id=${id}`} className="font-medium underline">
                      Collect payment
                    </Link>{" "}
                    first, or confirm below to check out with the amount outstanding.
                  </p>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="allow_outstanding" />
                    Check out with {formatMoney(due)} outstanding
                  </label>
                </>
              ) : null}
              <SubmitButton className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
                Complete check-out
              </SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      ) : null}

      {checkIn || checkOut ? (
        <Panel>
          <h3 className="mb-2 font-semibold">Stay record</h3>
          <ul className="space-y-1 text-sm text-[var(--muted)]">
            {checkIn ? (
              <li>
                Checked in {dateTime.format(new Date(checkIn.checked_in_at))}
                {checkIn.id_verified ? " · ID verified" : ""}
                {checkIn.additional_guests ? ` · ${checkIn.additional_guests} additional guest(s)` : ""}
              </li>
            ) : null}
            {checkOut ? (
              <li>
                Checked out {dateTime.format(new Date(checkOut.checked_out_at))} · Final bill{" "}
                {formatMoney(checkOut.final_bill)} · Outstanding {formatMoney(checkOut.outstanding)}
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-3 font-semibold">Bill</h3>
          <dl className="space-y-2 text-sm">
            {(
              [
                [`Room (${booking.nights} night${booking.nights === 1 ? "" : "s"} × ${formatMoney(booking.room_rate)})`, Number(booking.room_rate) * Number(booking.nights)],
                ["Extra bed", Number(booking.extra_bed_charge)],
                ["Additional charges", Number(booking.additional_charges)],
                ["Folio charges", Number(booking.folio_total)],
                ["Discount", -Number(booking.discount_amount)],
                ["GST on invoice", Number(booking.tax_total)],
                ["Credit notes", -Number(booking.credited_total)],
              ] as [string, number][]
            )
              .filter(([, v]) => v !== 0)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-[var(--muted)]">{k}</dt>
                  <dd>{formatMoney(v)}</dd>
                </div>
              ))}
            <div className="flex justify-between border-t border-[var(--line)] pt-2 font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(booking.total_amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Paid</dt>
              <dd>{formatMoney(booking.amount_paid)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Balance due</dt>
              <dd>{formatMoney(booking.balance_due)}</dd>
            </div>
            {Number(booking.amount_paid) > Number(booking.total_amount) ? (
              <div className="flex justify-between text-amber-800">
                <dt>Paid above total (refund due)</dt>
                <dd>{formatMoney(Number(booking.amount_paid) - Number(booking.total_amount))}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Source: {labelize(booking.source)} · {booking.adults} adult{booking.adults === 1 ? "" : "s"}
            {booking.children ? `, ${booking.children} child${booking.children === 1 ? "" : "ren"}` : ""} ·{" "}
            <Link href={`/guests/${guest?.id}`} className="font-medium text-[var(--brand)] hover:underline">
              Guest profile
            </Link>
          </p>
          {booking.notes ? <p className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">{booking.notes}</p> : null}
        </Panel>

        <Panel>
          <h3 className="mb-3 font-semibold">Booking status</h3>
          {nextStatuses.length ? (
            <ActionForm action={setStatus} className="grid gap-3 sm:grid-cols-2">
              <Field label="Change status to">
                <select name="status" required className={inputCls} defaultValue={nextStatuses[0]}>
                  {nextStatuses.map((s) => (
                    <option key={s} value={s}>{labelize(s)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reason / note (optional)">
                <input name="note" placeholder="e.g. guest called to cancel" className={inputCls} />
              </Field>
              {hasPayments ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">
                  {formatMoney(booking.amount_paid)} has been paid on this booking. Cancelling does not refund it
                  automatically — record a refund separately.
                </p>
              ) : null}
              <SubmitButton className={`${btnPrimary} sm:col-span-2`}>Update status</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              {status === "checked_in"
                ? "Guest is in-house. Use Check out above to finish the stay."
                : "This booking is complete; its status can no longer be changed."}
            </p>
          )}
          <h4 className="mb-2 mt-5 text-sm font-semibold">History</h4>
          <ul className="divide-y divide-[var(--line)] text-sm">
            {(history || []).map((h) => (
              <li key={h.id} className="flex items-start justify-between gap-3 py-2">
                <span>
                  {h.from_status ? labelize(h.from_status) : "Created"} → {labelize(h.to_status)}
                  <span className="block text-xs text-[var(--muted)]">
                    {rel(h.profiles as { full_name: string } | null)?.full_name ?? "System"}
                    {h.notes ? ` · ${h.notes}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{dateTime.format(new Date(h.created_at))}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel>
        <h3 className="mb-3 font-semibold">Folio charges</h3>
        {activeInvoice ? (
          <p className="mb-3 rounded-xl bg-[var(--brand-tint)] px-3 py-2 text-sm text-[var(--brand)]">
            Charges are frozen because invoice {activeInvoice.invoice_number} has been issued. Void the invoice to change
            them.
          </p>
        ) : null}
        {status === "checked_in" && !activeInvoice ? (
          <FolioForm
            services={(services || []).map((s) => ({
              id: s.id,
              name: s.name,
              default_amount: Number(s.default_amount),
            }))}
            action={addCharge}
          />
        ) : status === "checked_out" ? null : (
          <p className="mb-3 text-sm text-[var(--muted)]">Extra charges can be added once the guest is checked in.</p>
        )}
        {!activeFolio.length ? (
          <EmptyState message="No extra charges." />
        ) : (
          <ul className="divide-y divide-[var(--line)] text-sm">
            {activeFolio.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {f.description} × {f.quantity}
                  <span className="ml-2 text-xs text-[var(--muted)]">{formatDate(f.created_at)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">{formatMoney(f.amount)}</span>
                  {status === "checked_in" && !activeInvoice ? (
                    <ActionForm action={doVoid} className="flex items-center gap-1" successMessage="Voided">
                      <input type="hidden" name="charge_id" value={f.id} />
                      <input
                        name="reason"
                        required
                        placeholder="Reason to void"
                        aria-label={`Reason to void ${f.description}`}
                        className={`${inputCls} !w-36 !py-1 text-xs`}
                      />
                      <SubmitButton className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs hover:bg-rose-50" pendingLabel="…">
                        Void
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {voidedFolio.length ? (
          <div className="mt-4 border-t border-[var(--line)] pt-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Voided charges</p>
            <ul className="space-y-1 text-xs text-[var(--muted)]">
              {voidedFolio.map((f) => (
                <li key={f.id} className="flex justify-between">
                  <span className="line-through">
                    {f.description} × {f.quantity}
                  </span>
                  <span>
                    {formatMoney(f.amount)} · {f.void_reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <h3 className="mb-3 font-semibold">Payments</h3>
        {!payments?.length ? (
          <EmptyState message="No payments recorded." />
        ) : (
          <ul className="divide-y divide-[var(--line)] text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className={p.voided ? "text-[var(--muted)] line-through" : ""}>
                  {formatMoney(p.amount)} · {p.method}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  {p.voided ? <StatusPill tone="danger">Voided</StatusPill> : null}
                  <Link href={`/payments/${p.id}`} className="font-medium text-[var(--brand)] hover:underline">
                    {p.receipt_no ?? "Receipt"}
                  </Link>
                  <span className="text-[var(--muted)]">{formatDate(p.received_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
