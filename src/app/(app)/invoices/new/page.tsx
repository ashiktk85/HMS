import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  Field,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { bookingLabel, formatDate, formatMoney, rel } from "@/lib/types";
import { issueInvoice } from "../actions";

type Line = { description: string; quantity: number; unit_amount: number; amount: number; tax_rate: number };
type TaxRow = { name: string; rate: number; taxable: number; amount: number };
type Calc = {
  lines: Line[];
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax_total: number;
  total: number;
  tax_rows: TaxRow[];
};
type GuestRef = { id?: string; full_name: string; gstin: string | null; address: string | null };
type RoomRef = { room_number: string };

const stateCode = (gstin?: string | null) => (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null);

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Booking ids that already sit on an active (issued / credited) invoice, alone or combined. */
async function invoicedBookingIds(supabase: Supabase) {
  const [{ data: single }, { data: linked }] = await Promise.all([
    supabase.from("invoices").select("booking_id").in("status", ["issued", "credited"]),
    // Absent until migration 010 is applied; then the error just leaves this empty.
    supabase.from("invoice_bookings").select("booking_id, invoices!inner(status)").in("invoices.status", ["issued", "credited"]),
  ]);
  return new Set([...(single || []).map((i) => i.booking_id), ...(linked || []).map((i) => i.booking_id)]);
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ booking_id?: string | string[]; type?: string; inter?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ids = [...new Set([sp.booking_id ?? []].flat().filter(Boolean))];

  // ---- Step 1: choose the booking(s) ----
  if (!ids.length) {
    const [{ data: bookings }, done] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_code, status, total_amount, check_in_date, check_out_date, guest_id, guests(full_name), rooms(room_number)")
        .in("status", ["checked_in", "checked_out"])
        .order("created_at", { ascending: false })
        .limit(200),
      invoicedBookingIds(supabase),
    ]);
    const open = (bookings || []).filter((b) => !done.has(b.id));

    // One card per guest, so a guest's rooms can be ticked and billed together.
    const byGuest = new Map<string, { name: string; rows: typeof open }>();
    for (const b of open) {
      const name = rel(b.guests as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "Guest";
      const g = byGuest.get(b.guest_id) ?? { name, rows: [] };
      g.rows.push(b);
      byGuest.set(b.guest_id, g);
    }

    return (
      <div className="space-y-6">
        <PageHeader
          title="New invoice"
          description="Invoice a stay once the guest is checked in. If a guest has booked more than one room, tick them all to bill together on one invoice."
          actions={<Link href="/invoices" className={btnSoft}>All invoices</Link>}
        />
        {!byGuest.size ? (
          <Panel>
            <EmptyState message="No checked-in or checked-out bookings are waiting for an invoice." />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...byGuest.entries()].map(([guestId, g]) => (
              <Panel key={guestId}>
                <form action="/invoices/new" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{g.name}</h3>
                    <span className="text-xs text-[var(--muted)]">
                      {g.rows.length} booking{g.rows.length === 1 ? "" : "s"} to invoice
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {g.rows.map((b) => (
                      <li key={b.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm transition hover:border-[var(--brand)] has-[:checked]:border-[var(--brand)] has-[:checked]:bg-[var(--brand-tint)]">
                          <input
                            type="checkbox"
                            name="booking_id"
                            value={b.id}
                            defaultChecked={g.rows.length === 1}
                            className="h-4 w-4 accent-[var(--brand)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">
                              {b.booking_code} · Room {rel(b.rooms as RoomRef | RoomRef[] | null)?.room_number}
                            </span>
                            <span className="block text-xs text-[var(--muted)]">
                              {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)} · {bookingLabel(b.status)}
                            </span>
                          </span>
                          <span className="font-medium">{formatMoney(b.total_amount)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button type="submit" className={btnPrimary}>
                    Continue
                  </button>
                </form>
              </Panel>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- Step 2: preview and issue ----
  const [{ data: found }, { data: settings }, done] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, booking_code, status, check_in_date, check_out_date, guest_id, total_amount, guests(full_name, gstin, address), rooms(room_number)")
      .in("id", ids),
    supabase.from("hotel_settings").select("*").limit(1).maybeSingle(),
    invoicedBookingIds(supabase),
  ]);
  // Keep the order the bookings were picked in; the first one is the invoice's primary booking.
  const selected = ids.map((id) => (found || []).find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b);

  if (!selected.length || selected.length !== ids.length) {
    return (
      <div>
        <PageHeader title="New invoice" />
        <EmptyState message="Booking not found." />
      </div>
    );
  }

  const guestOf = (b: (typeof selected)[number]) => rel(b.guests as GuestRef | GuestRef[] | null);
  const guest = guestOf(selected[0]);
  const multi = selected.length > 1;

  const problem = selected.some((b) => b.guest_id !== selected[0].guest_id)
    ? "These bookings belong to different guests. Only one guest's bookings can be billed together."
    : selected.find((b) => done.has(b.id))
      ? `${selected.find((b) => done.has(b.id))!.booking_code} already has an invoice. Void it first if it needs to be re-issued.`
      : null;

  if (problem) {
    return (
      <div className="space-y-6">
        <PageHeader title="New invoice" actions={<Link href="/invoices/new" className={btnSoft}>Choose again</Link>} />
        <Panel>
          <p className="text-sm text-rose-700">{problem}</p>
        </Panel>
      </div>
    );
  }

  // The guest's other bookings that could join this invoice.
  const { data: others } = await supabase
    .from("bookings")
    .select("id, booking_code, status, total_amount, rooms(room_number)")
    .eq("guest_id", selected[0].guest_id)
    .in("status", ["checked_in", "checked_out"])
    .not("id", "in", `(${ids.join(",")})`)
    .order("created_at", { ascending: false });
  const addable = (others || []).filter((b) => !done.has(b.id));

  const type = sp.type === "non_gst" ? "non_gst" : "gst";
  const hotelState = stateCode(settings?.gstin);
  const guestState = stateCode(guest?.gstin);
  // Default: inter-state only when both GSTINs are known and their state codes differ.
  const suggestedInter = !!hotelState && !!guestState && hotelState !== guestState;
  const inter = sp.inter === "1" ? true : sp.inter === "0" ? false : suggestedInter;
  const interState = type === "gst" && inter;

  const { data: calcData, error: calcError } = multi
    ? await supabase.rpc("calc_combined_invoice", { p_booking_ids: ids, p_type: type, p_inter: interState })
    : await supabase.rpc("calc_invoice", { p_booking_id: ids[0], p_type: type, p_inter: interState });
  const calc = calcData as Calc | null;

  const idsQuery = ids.map((id) => `booking_id=${id}`).join("&");
  const base = `/invoices/new?${idsQuery}`;
  const tab = (active: boolean) =>
    `rounded-xl px-4 py-2 text-sm font-medium ${
      active ? "bg-[var(--brand)] text-white" : "border border-[var(--line)] hover:bg-[var(--brand-tint)]"
    }`;
  const gstBlocked = type === "gst" && !settings?.gstin?.trim();
  const codes = selected.map((b) => b.booking_code).join(" + ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={multi ? `Combined invoice · ${selected.length} bookings` : `Invoice for ${selected[0].booking_code}`}
        description={
          multi
            ? `${guest?.full_name} · ${codes}`
            : `${guest?.full_name} · ${selected[0].check_in_date} to ${selected[0].check_out_date} · ${bookingLabel(selected[0].status)}`
        }
        actions={<Link href="/invoices/new" className={btnSoft}>Choose another booking</Link>}
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Bookings on this invoice</h3>
          <span className="text-xs text-[var(--muted)]">All for {guest?.full_name}</span>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {selected.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--brand-tint)] p-3 text-sm">
              <span>
                <span className="block font-medium">
                  {b.booking_code} · Room {rel(b.rooms as RoomRef | RoomRef[] | null)?.room_number}
                </span>
                <span className="block text-xs text-[var(--muted)]">
                  {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                </span>
              </span>
              {multi ? (
                <Link
                  href={`/invoices/new?${ids.filter((x) => x !== b.id).map((x) => `booking_id=${x}`).join("&")}&type=${type}`}
                  className="text-xs font-medium text-[var(--muted)] hover:text-rose-700"
                >
                  Remove
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        {addable.length ? (
          <div className="mt-4 border-t border-[var(--line)] pt-3">
            <p className="mb-2 text-xs text-[var(--muted)]">
              {guest?.full_name} has other bookings. Add them to bill together on one invoice:
            </p>
            <div className="flex flex-wrap gap-2">
              {addable.map((b) => (
                <Link
                  key={b.id}
                  href={`${base}&booking_id=${b.id}&type=${type}`}
                  className="rounded-full border border-[var(--line)] px-3 py-1 text-sm font-medium text-[var(--brand)] transition hover:border-[var(--brand)] hover:bg-[var(--brand-tint)]"
                >
                  + {b.booking_code} · Room {rel(b.rooms as RoomRef | RoomRef[] | null)?.room_number}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <h3 className="mb-3 font-semibold">1. Invoice type</h3>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}&type=gst`} className={tab(type === "gst")}>GST invoice</Link>
          <Link href={`${base}&type=non_gst`} className={tab(type === "non_gst")}>Non-GST invoice</Link>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {type === "gst"
            ? "Adds GST (CGST + SGST within the state, IGST across states) at the rates set in Settings."
            : "No GST is added. The invoice total equals the bill."}
        </p>
        {type === "gst" ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Place of supply:</span>
            <Link href={`${base}&type=gst&inter=0`} className={tab(!inter)}>Same state (CGST + SGST)</Link>
            <Link href={`${base}&type=gst&inter=1`} className={tab(inter)}>Other state (IGST)</Link>
            <span className="text-xs text-[var(--muted)]">
              {hotelState && guestState
                ? `Hotel GSTIN state ${hotelState}, customer ${guestState}.`
                : "Defaults to same state when the customer GSTIN is unknown."}
            </span>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <h3 className="mb-3 font-semibold">2. Review the bill</h3>
        {calcError || !calc ? (
          <p className="text-sm text-rose-700">
            {calcError?.message ?? "Could not calculate the invoice."}
            {multi && calcError?.message?.includes("calc_combined_invoice")
              ? " Run migration 010_combined_invoices.sql in the Supabase SQL Editor to enable combined invoices."
              : ""}
          </p>
        ) : (
          <>
            <DataTable
              searchable={false}
              pageSize={100}
              columns={[
                { header: "Description", maxWidth: "28rem" },
                { header: "Qty", align: "right" },
                { header: "Rate", align: "right" },
                { header: "Amount", align: "right" },
                ...(type === "gst" ? [{ header: "GST %", align: "right" as const }] : []),
              ]}
              rows={calc.lines.map((l, i) => ({
                key: String(i),
                cells: [
                  l.description,
                  l.quantity,
                  formatMoney(l.unit_amount),
                  formatMoney(l.amount),
                  ...(type === "gst" ? [`${l.tax_rate}%`] : []),
                ],
              }))}
            />
            <dl className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">Taxable value</dt>
                <dd>{formatMoney(calc.taxable_value)}</dd>
              </div>
              {calc.tax_rows.map((t) => (
                <div key={`${t.name}-${t.rate}`} className="flex justify-between">
                  <dt className="text-[var(--muted)]">
                    {t.name} @ {t.rate}%
                  </dt>
                  <dd>{formatMoney(t.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-[var(--line)] pt-2 text-base font-semibold">
                <dt>Invoice total</dt>
                <dd>{formatMoney(calc.total)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Issuing adds the tax to {multi ? "each booking" : "the booking"}, so the balance due and payments follow the invoice total. Charges
              are frozen until the invoice is voided.
              {multi ? " Payments already taken on any of these rooms are shown on the bill." : ""}
            </p>
          </>
        )}
      </Panel>

      <Panel>
        <h3 className="mb-3 font-semibold">3. Billing details and issue</h3>
        {gstBlocked ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The hotel GSTIN is not set, so GST invoices cannot be issued.{" "}
            <Link href="/settings" className="font-medium underline">Add it in Settings</Link>.
          </p>
        ) : (
          <ActionForm action={issueInvoice} className="grid gap-4 sm:grid-cols-2" successMessage="Invoice issued">
            {ids.map((id) => (
              <input key={id} type="hidden" name="booking_id" value={id} />
            ))}
            <input type="hidden" name="invoice_type" value={type} />
            <input type="hidden" name="inter_state" value={interState ? "1" : "0"} />
            <Field label="Billed to" hint="Guest name, or the company if it is paying">
              <input name="billing_name" defaultValue={guest?.full_name ?? ""} required className={inputCls} />
            </Field>
            {type === "gst" ? (
              <Field
                label="Customer GSTIN (optional)"
                hint="15 characters, for business customers. If it is in another state, choose “Other state” above."
              >
                <input name="billing_gstin" defaultValue={guest?.gstin ?? ""} maxLength={15} className={`${inputCls} uppercase`} />
              </Field>
            ) : null}
            <Field label="Billing address (optional)" className="sm:col-span-2">
              <input name="billing_address" defaultValue={guest?.address ?? ""} className={inputCls} />
            </Field>
            <Field label="Note on invoice (optional)" className="sm:col-span-2">
              <input name="notes" className={inputCls} />
            </Field>
            <SubmitButton className={`${btnPrimary} sm:col-span-2`} pendingLabel="Issuing…">
              Issue {multi ? "combined " : ""}
              {type === "gst" ? "GST" : "non-GST"} invoice
            </SubmitButton>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
