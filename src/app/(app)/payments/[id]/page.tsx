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
import { canAccessSettings, formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { notFound } from "next/navigation";
import { requestRefund, voidPayment } from "../actions";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type Guest = { id: string; full_name: string };
type PaymentBooking = {
  id: string;
  booking_code: string;
  status: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  guests: Guest | Guest[] | null;
};

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  const canManage = canAccessSettings(session?.role);
  const supabase = await createClient();

  const { data: payment } = await supabase
    .from("payments")
    .select(
      "*, bookings(id, booking_code, status, total_amount, amount_paid, balance_due, guests(id, full_name)), profiles!payments_received_by_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!payment) notFound();

  const [{ data: refunds }, { data: methods }] = await Promise.all([
    supabase.from("refunds").select("*").eq("payment_id", id).order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  const booking = rel(payment.bookings as PaymentBooking | PaymentBooking[] | null);
  const guest = rel(booking?.guests ?? null);
  const receivedBy = rel(
    payment.profiles as { full_name: string } | { full_name: string }[] | null,
  )?.full_name;

  const committed = (refunds || [])
    .filter((r) => r.approval_status !== "rejected")
    .reduce((s, r) => s + Number(r.amount), 0);
  const refundable = Math.max(Number(payment.amount) - committed, 0);
  const hasLiveRefund = (refunds || []).some((r) => ["pending", "approved"].includes(r.approval_status));
  const defaultMethod = (methods || []).find((m) => m.name === payment.method)?.id ?? methods?.[0]?.id;
  const overpaid = booking
    ? Math.max(Number(booking.amount_paid) - Number(booking.total_amount), 0)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Receipt ${payment.receipt_no}`}
        description={`${guest?.full_name ?? "Guest"} · ${booking?.booking_code}`}
        actions={
          <>
            <Link href="/payments" className={btnSoft}>
              All payments
            </Link>
            <a href={`/print/payments/${id}`} target="_blank" rel="noreferrer" className={btnPrimary}>
              Print receipt
            </a>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4 flex items-center gap-3">
            <p className="text-3xl font-semibold">{formatMoney(payment.amount)}</p>
            {payment.voided ? <StatusPill tone="danger">Voided</StatusPill> : <StatusPill tone="ok">Received</StatusPill>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              ["Method", payment.method],
              ["Reference", payment.reference || "—"],
              ["Received", dateTime.format(new Date(payment.received_at))],
              ["Received by", receivedBy || "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-[var(--muted)]">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {payment.notes ? <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm">{payment.notes}</p> : null}
          {payment.voided ? (
            <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
              Voided {payment.voided_at ? dateTime.format(new Date(payment.voided_at)) : ""}: {payment.void_reason}
            </p>
          ) : null}
          {booking ? (
            <div className="mt-4 rounded-2xl bg-[var(--brand-tint)] p-4 text-sm">
              <p className="mb-2 font-medium">
                <Link href={`/bookings/${booking.id}`} className="text-[var(--brand)] hover:underline">
                  {booking.booking_code}
                </Link>{" "}
                <span className="font-normal text-[var(--muted)]">({labelize(booking.status)})</span>
              </p>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Booking total</span>
                <span>{formatMoney(booking.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Paid</span>
                <span>{formatMoney(booking.amount_paid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance due</span>
                <span>{formatMoney(booking.balance_due)}</span>
              </div>
              {overpaid > 0 ? (
                <p className="mt-2 text-xs text-amber-800">
                  Paid is {formatMoney(overpaid)} more than the total (for example after a discount). Refund the extra.
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <h3 className="mb-3 font-semibold">Refund</h3>
            {payment.voided ? (
              <p className="text-sm text-[var(--muted)]">A voided payment cannot be refunded.</p>
            ) : refundable <= 0 ? (
              <p className="text-sm text-[var(--muted)]">This payment has been fully refunded.</p>
            ) : (
              <ActionForm
                action={requestRefund}
                resetOnSuccess
                successMessage="Refund recorded"
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="payment_id" value={id} />
                <input type="hidden" name="booking_id" value={payment.booking_id} />
                <Field label="Refund amount (₹)" hint={`Up to ${formatMoney(refundable)}`}>
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max={refundable}
                    step="0.01"
                    defaultValue={refundable}
                    required
                    className={inputCls}
                  />
                </Field>
                <Field label="Pay out by">
                  <select name="method_id" defaultValue={defaultMethod} required className={inputCls}>
                    {(methods || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reason (required)" className="sm:col-span-2">
                  <input name="reason" required placeholder="Booking cancelled by guest" className={inputCls} />
                </Field>
                <p className="text-xs text-[var(--muted)] sm:col-span-2">
                  Depending on settings, the refund may wait for an owner or manager to approve it. The original
                  payment stays on record.
                </p>
                <SubmitButton className={`${btnPrimary} sm:col-span-2`}>Request refund</SubmitButton>
              </ActionForm>
            )}

            <h4 className="mb-2 mt-5 text-sm font-semibold">Refunds on this payment</h4>
            {!refunds?.length ? (
              <EmptyState message="No refunds." />
            ) : (
              <ul className="divide-y divide-[var(--line)] text-sm">
                {refunds.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                    <span>
                      {formatMoney(r.amount)} · {r.method}
                      <span className="block text-xs text-[var(--muted)]">
                        {r.reason} · {formatDate(r.created_at)}
                        {r.decision_note ? ` · ${r.decision_note}` : ""}
                      </span>
                    </span>
                    <StatusPill
                      tone={
                        r.approval_status === "approved"
                          ? "ok"
                          : r.approval_status === "rejected"
                            ? "danger"
                            : "warn"
                      }
                    >
                      {labelize(r.approval_status)}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canManage && !payment.voided ? (
            <Panel>
              <h3 className="mb-1 font-semibold">Void this payment</h3>
              <p className="mb-3 text-sm text-[var(--muted)]">
                Only for entry mistakes (wrong booking or amount). The payment stays on record as voided and the
                account and booking balance are corrected. To return money to a guest, use a refund instead.
              </p>
              {hasLiveRefund ? (
                <p className="text-sm text-amber-800">This payment has refunds, so it cannot be voided.</p>
              ) : (
                <ActionForm
                  action={voidPayment}
                  successMessage="Payment voided"
                  className="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="payment_id" value={id} />
                  <input type="hidden" name="booking_id" value={payment.booking_id} />
                  <Field label="Reason (required)" className="min-w-56 flex-1">
                    <input name="reason" required placeholder="Entered against the wrong booking" className={inputCls} />
                  </Field>
                  <SubmitButton className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100">
                    Void payment
                  </SubmitButton>
                </ActionForm>
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
