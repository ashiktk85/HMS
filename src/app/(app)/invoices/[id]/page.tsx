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
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { notFound } from "next/navigation";
import { createCreditNote, voidInvoice } from "../actions";

const statusTone = (s: string) =>
  s === "issued" ? ("ok" as const) : s === "voided" ? ("danger" as const) : ("warn" as const);

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  const canAdjust = ["owner", "manager", "accountant"].includes(session?.role ?? "");
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, guests(full_name), bookings(id, booking_code, total_amount, amount_paid, balance_due)")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) notFound();

  const [{ data: items }, { data: taxes }, { data: credits }] = await Promise.all([
    supabase.from("invoice_items").select("*").eq("invoice_id", id),
    supabase.from("tax_details").select("*").eq("invoice_id", id).order("tax_name"),
    supabase.from("credit_notes").select("*").eq("invoice_id", id).order("created_at"),
  ]);

  const booking = rel(
    invoice.bookings as
      | { id: string; booking_code: string; total_amount: number; amount_paid: number; balance_due: number }
      | { id: string; booking_code: string; total_amount: number; amount_paid: number; balance_due: number }[]
      | null,
  );
  const creditedTaxable = (credits || []).reduce((s, c) => s + Number(c.taxable_value), 0);
  const remaining = Math.max(Number(invoice.taxable_value) - creditedTaxable, 0);
  const isGst = invoice.invoice_type === "gst";
  const tax = Number(invoice.cgst_amount) + Number(invoice.sgst_amount) + Number(invoice.igst_amount);

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.invoice_number}
        description={`${labelize(invoice.invoice_type)} invoice · ${invoice.billing_name ?? rel(invoice.guests as { full_name: string } | null)?.full_name} · ${formatDate(invoice.issued_at)}`}
        actions={
          <>
            <Link href="/invoices" className={btnSoft}>
              Register
            </Link>
            <a href={`/print/invoices/${id}`} target="_blank" rel="noreferrer" className={btnPrimary}>
              Print / save as PDF
            </a>
          </>
        }
      />

      {invoice.status === "voided" ? (
        <Panel className="border-rose-200 bg-rose-50">
          <p className="text-sm text-rose-800">
            Voided {formatDate(invoice.voided_at)}: {invoice.void_reason}. The number stays in the register and is not reused.
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Status</p>
          <div className="mt-2"><StatusPill tone={statusTone(invoice.status)}>{labelize(invoice.status)}</StatusPill></div>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Taxable value</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(invoice.taxable_value)}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">GST</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(tax)}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Invoice total</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(invoice.total_amount)}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <h3 className="mb-3 font-semibold">Items</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Description</th>
                  <th className="text-right font-medium">Qty</th>
                  <th className="text-right font-medium">Rate</th>
                  <th className="text-right font-medium">Amount</th>
                  {isGst ? <th className="text-right font-medium">GST %</th> : null}
                </tr>
              </thead>
              <tbody>
                {(items || []).map((it) => (
                  <tr key={it.id} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      {it.description}
                      {isGst && it.sac_code ? <span className="ml-2 text-xs text-[var(--muted)]">SAC {it.sac_code}</span> : null}
                    </td>
                    <td className="text-right">{it.quantity}</td>
                    <td className="text-right">{formatMoney(it.unit_amount)}</td>
                    <td className="text-right">{formatMoney(it.amount)}</td>
                    {isGst ? <td className="text-right">{it.tax_rate}%</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Taxable value</dt>
              <dd>{formatMoney(invoice.taxable_value)}</dd>
            </div>
            {(taxes || []).map((t) => (
              <div key={t.id} className="flex justify-between">
                <dt className="text-[var(--muted)]">
                  {t.tax_name} @ {t.rate}%
                </dt>
                <dd>{formatMoney(t.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-[var(--line)] pt-2 font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(invoice.total_amount)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel>
          <h3 className="mb-3 font-semibold">Details</h3>
          <dl className="space-y-2 text-sm">
            {[
              ["Booking", booking?.booking_code],
              ["Billed to", invoice.billing_name],
              ["Customer GSTIN", invoice.customer_gstin || "—"],
              ["Hotel GSTIN", invoice.hotel_gstin || "—"],
              ["Supply", isGst ? (invoice.is_inter_state ? "Other state (IGST)" : "Same state (CGST + SGST)") : "—"],
              ["Financial year", invoice.fiscal_year || "—"],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-[var(--muted)]">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {booking ? (
            <div className="mt-4 rounded-2xl bg-[var(--brand-tint)] p-3 text-sm">
              <div className="flex justify-between"><span className="text-[var(--muted)]">Booking total</span><span>{formatMoney(booking.total_amount)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Paid</span><span>{formatMoney(booking.amount_paid)}</span></div>
              <div className="flex justify-between font-semibold"><span>Balance due</span><span>{formatMoney(booking.balance_due)}</span></div>
              {Number(booking.balance_due) > 0 && invoice.status !== "voided" ? (
                <Link href={`/payments/new?booking_id=${booking.id}`} className="mt-2 inline-block text-xs font-medium text-[var(--brand)] hover:underline">
                  Record payment
                </Link>
              ) : null}
            </div>
          ) : null}
          {invoice.notes ? <p className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">{invoice.notes}</p> : null}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-3 font-semibold">Credit notes</h3>
          {!credits?.length ? (
            <EmptyState message="No credit notes." />
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {credits.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{c.credit_note_number}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {c.reason} · {formatDate(c.created_at)}
                    </span>
                  </span>
                  <span className="text-right">
                    {formatMoney(c.amount)}
                    <span className="block text-xs text-[var(--muted)]">taxable {formatMoney(c.taxable_value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {invoice.status === "issued" && canAdjust ? (
            <ActionForm action={createCreditNote} resetOnSuccess successMessage="Credit note issued" className="mt-5 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="invoice_id" value={id} />
              <input type="hidden" name="booking_id" value={invoice.booking_id} />
              <Field label="Credit amount before tax (₹)" hint={`Up to ${formatMoney(remaining)}. GST is added in proportion.`}>
                <input name="amount" type="number" min="0.01" max={remaining} step="0.01" defaultValue={remaining} required className={inputCls} />
              </Field>
              <Field label="Reason (required)">
                <input name="reason" required placeholder="Room rate corrected" className={inputCls} />
              </Field>
              <SubmitButton className={`${btnPrimary} sm:col-span-2`}>Issue credit note</SubmitButton>
            </ActionForm>
          ) : null}
        </Panel>

        {invoice.status === "issued" && canAdjust ? (
          <Panel>
            <h3 className="mb-1 font-semibold">Void this invoice</h3>
            <p className="mb-3 text-sm text-[var(--muted)]">
              For wrong details or a mistaken invoice. It stays in the register as voided, its number is not reused,
              and the tax comes off the booking so you can issue a corrected one. Use a credit note to adjust an
              amount instead.
            </p>
            {credits?.length ? (
              <p className="text-sm text-amber-800">This invoice has credit notes, so it cannot be voided.</p>
            ) : (
              <ActionForm action={voidInvoice} successMessage="Invoice voided" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="invoice_id" value={id} />
                <input type="hidden" name="booking_id" value={invoice.booking_id} />
                <Field label="Reason (required)" className="min-w-56 flex-1">
                  <input name="reason" required placeholder="Wrong GSTIN entered" className={inputCls} />
                </Field>
                <SubmitButton className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100">
                  Void invoice
                </SubmitButton>
              </ActionForm>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
