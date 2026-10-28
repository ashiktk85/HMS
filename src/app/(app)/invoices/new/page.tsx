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
import { createClient } from "@/lib/supabase/server";
import { formatMoney, labelize, rel } from "@/lib/types";
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

const stateCode = (gstin?: string | null) => (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null);

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ booking_id?: string; type?: string; inter?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // ---- Step 1: choose the booking ----
  if (!sp.booking_id) {
    const [{ data: bookings }, { data: invoiced }] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_code, status, total_amount, guests(full_name)")
        .in("status", ["checked_in", "checked_out"])
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("invoices").select("booking_id").in("status", ["issued", "credited"]),
    ]);
    const done = new Set((invoiced || []).map((i) => i.booking_id));
    const open = (bookings || []).filter((b) => !done.has(b.id));
    return (
      <div className="space-y-6">
        <PageHeader
          title="New invoice"
          description="Invoice a stay once the guest is checked in. Pick the booking first."
          actions={<Link href="/invoices" className={btnSoft}>All invoices</Link>}
        />
        <Panel>
          {!open.length ? (
            <EmptyState message="No checked-in or checked-out bookings are waiting for an invoice." />
          ) : (
            <form className="flex flex-wrap items-end gap-3">
              <Field label="Booking" className="min-w-72 flex-1">
                <select name="booking_id" required defaultValue="" className={inputCls}>
                  <option value="">Select booking</option>
                  {open.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.booking_code} · {rel(b.guests as { full_name: string } | { full_name: string }[] | null)?.full_name} ·{" "}
                      {labelize(b.status)}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="submit" className={btnPrimary}>Continue</button>
            </form>
          )}
        </Panel>
      </div>
    );
  }

  // ---- Step 2: preview and issue ----
  const [{ data: booking }, { data: settings }, { data: existing }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, booking_code, status, check_in_date, check_out_date, guests(full_name, gstin, address)")
      .eq("id", sp.booking_id)
      .maybeSingle(),
    supabase.from("hotel_settings").select("*").limit(1).maybeSingle(),
    supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("booking_id", sp.booking_id)
      .in("status", ["issued", "credited"])
      .maybeSingle(),
  ]);

  if (!booking) {
    return (
      <div>
        <PageHeader title="New invoice" />
        <EmptyState message="Booking not found." />
      </div>
    );
  }

  const guest = rel(
    booking.guests as
      | { full_name: string; gstin: string | null; address: string | null }
      | { full_name: string; gstin: string | null; address: string | null }[]
      | null,
  );

  if (existing) {
    return (
      <div className="space-y-6">
        <PageHeader title="New invoice" />
        <Panel>
          <p className="text-sm">
            {booking.booking_code} already has invoice{" "}
            <Link href={`/invoices/${existing.id}`} className="font-medium text-[var(--brand)] hover:underline">
              {existing.invoice_number}
            </Link>
            . Void it first if it needs to be re-issued.
          </p>
        </Panel>
      </div>
    );
  }

  const type = sp.type === "non_gst" ? "non_gst" : "gst";
  const hotelState = stateCode(settings?.gstin);
  const guestState = stateCode(guest?.gstin);
  // Default: inter-state only when both GSTINs are known and their state codes differ.
  const suggestedInter = !!hotelState && !!guestState && hotelState !== guestState;
  const inter = sp.inter === "1" ? true : sp.inter === "0" ? false : suggestedInter;
  const interState = type === "gst" && inter;

  const { data: calcData, error: calcError } = await supabase.rpc("calc_invoice", {
    p_booking_id: booking.id,
    p_type: type,
    p_inter: interState,
  });
  const calc = calcData as Calc | null;

  const base = `/invoices/new?booking_id=${booking.id}`;
  const tab = (active: boolean) =>
    `rounded-xl px-4 py-2 text-sm font-medium ${
      active ? "bg-[var(--brand)] text-white" : "border border-[var(--line)] hover:bg-[var(--brand-tint)]"
    }`;
  const gstBlocked = type === "gst" && !settings?.gstin?.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Invoice for ${booking.booking_code}`}
        description={`${guest?.full_name} · ${booking.check_in_date} to ${booking.check_out_date} · ${labelize(booking.status)}`}
        actions={<Link href="/invoices/new" className={btnSoft}>Choose another booking</Link>}
      />

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
          <p className="text-sm text-rose-700">{calcError?.message ?? "Could not calculate the invoice."}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[var(--muted)]">
                  <tr>
                    <th className="py-2 font-medium">Description</th>
                    <th className="text-right font-medium">Qty</th>
                    <th className="text-right font-medium">Rate</th>
                    <th className="text-right font-medium">Amount</th>
                    {type === "gst" ? <th className="text-right font-medium">GST %</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {calc.lines.map((l, i) => (
                    <tr key={i} className="border-t border-[var(--line)]">
                      <td className="py-2">{l.description}</td>
                      <td className="text-right">{l.quantity}</td>
                      <td className="text-right">{formatMoney(l.unit_amount)}</td>
                      <td className="text-right">{formatMoney(l.amount)}</td>
                      {type === "gst" ? <td className="text-right">{l.tax_rate}%</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              Issuing adds the tax to the booking, so the balance due and payments follow the invoice total. Charges
              are frozen until the invoice is voided.
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
            <input type="hidden" name="booking_id" value={booking.id} />
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
              Issue {type === "gst" ? "GST" : "non-GST"} invoice
            </SubmitButton>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
