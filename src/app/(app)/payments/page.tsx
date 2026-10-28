import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  StatusPill,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canAccessSettings, formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { decideRefund } from "./actions";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; method?: string }>;
}) {
  const { q, method } = await searchParams;
  const session = await getSessionProfile();
  const canDecide = canAccessSettings(session?.role);
  const supabase = await createClient();

  let paymentsQuery = supabase
    .from("payments")
    .select("*, bookings(booking_code, guests(full_name))")
    .order("received_at", { ascending: false })
    .limit(100);
  if (method) paymentsQuery = paymentsQuery.eq("method", method);

  // Search by receipt number or reference; strip characters that break the filter string.
  const term = (q || "").replace(/[,()%*\\]/g, " ").trim();
  if (term) {
    paymentsQuery = paymentsQuery.or(`receipt_no.ilike.%${term}%,reference.ilike.%${term}%`);
  }

  const [{ data: payments }, { data: refunds }, { data: methods }] = await Promise.all([
    paymentsQuery,
    supabase
      .from("refunds")
      .select("*, payments(receipt_no), bookings(booking_code)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("payment_methods").select("name").order("sort_order"),
  ]);

  const pending = (refunds || []).filter((r) => r.approval_status === "pending");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Cash, UPI, bank and card. Each payment updates the booking balance and the right account."
        actions={
          <Link href="/payments/new" className={btnPrimary}>
            Record payment
          </Link>
        }
      />

      {pending.length ? (
        <Panel className="border-amber-200 bg-amber-50/60">
          <h3 className="mb-3 font-semibold">Refunds waiting for approval ({pending.length})</h3>
          <ul className="space-y-3 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {formatMoney(r.amount)} · {rel(r.bookings as { booking_code: string } | null)?.booking_code} ·{" "}
                    {rel(r.payments as { receipt_no: string } | null)?.receipt_no}
                  </p>
                  <p className="text-[var(--muted)]">
                    {r.reason} · paid out by {r.method}
                  </p>
                </div>
                {canDecide ? (
                  <ActionForm action={decideRefund} className="flex flex-wrap items-center gap-2" successMessage="Done">
                    <input type="hidden" name="refund_id" value={r.id} />
                    <input name="note" placeholder="Note (optional)" className={`${inputCls} !w-40 !py-1 text-xs`} aria-label="Decision note" />
                    <SubmitButton name="decision" value="approve" className={`${btnPrimary} !py-1 text-xs`} pendingLabel="…">
                      Approve
                    </SubmitButton>
                    <SubmitButton name="decision" value="reject" className="rounded-xl border border-[var(--line)] bg-white px-3 py-1 text-xs font-medium hover:bg-rose-50" pendingLabel="…">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <span className="text-xs text-[var(--muted)]">An owner or manager must approve.</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <form className="mb-4 flex flex-wrap gap-2">
          <input name="q" defaultValue={q || ""} placeholder="Search receipt number or reference" className={`${inputCls} !w-72`} />
          <select name="method" defaultValue={method || ""} className={`${inputCls} !w-44`} aria-label="Payment method">
            <option value="">All methods</option>
            {(methods || []).map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          <button type="submit" className={btnSoft}>Filter</button>
        </form>

        {!payments?.length ? (
          <EmptyState message={term || method ? "No payments match." : "No payments yet."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Receipt</th>
                  <th className="font-medium">Booking / guest</th>
                  <th className="font-medium">Amount</th>
                  <th className="font-medium">Method</th>
                  <th className="font-medium">Reference</th>
                  <th className="font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const b = rel(
                    p.bookings as
                      | { booking_code: string; guests: { full_name: string } | { full_name: string }[] | null }
                      | { booking_code: string; guests: { full_name: string } | { full_name: string }[] | null }[]
                      | null,
                  );
                  return (
                    <tr key={p.id} className="border-t border-[var(--line)]">
                      <td className="py-3">
                        <Link href={`/payments/${p.id}`} className="font-medium text-[var(--brand)] hover:underline">
                          {p.receipt_no}
                        </Link>
                        {p.voided ? <span className="ml-2"><StatusPill tone="danger">Voided</StatusPill></span> : null}
                      </td>
                      <td>
                        {b?.booking_code}
                        <span className="block text-xs text-[var(--muted)]">{rel(b?.guests ?? null)?.full_name}</span>
                      </td>
                      <td className={p.voided ? "text-[var(--muted)] line-through" : ""}>{formatMoney(p.amount)}</td>
                      <td>{p.method}</td>
                      <td>{p.reference || "—"}</td>
                      <td className="whitespace-nowrap">{formatDate(p.received_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <h3 className="mb-1 font-semibold">Refunds</h3>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Original payments are never deleted. A refund is recorded against the payment and adjusts balances and
          accounts. Request one from the payment&apos;s page.
        </p>
        {!refunds?.length ? (
          <EmptyState message="No refunds." />
        ) : (
          <ul className="divide-y divide-[var(--line)] text-sm">
            {refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {formatMoney(r.amount)} · {rel(r.bookings as { booking_code: string } | null)?.booking_code}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {r.reason || "No reason"} · {r.method} · {formatDate(r.created_at)}
                    {r.decision_note ? ` · ${r.decision_note}` : ""}
                  </p>
                </div>
                <StatusPill
                  tone={r.approval_status === "approved" ? "ok" : r.approval_status === "rejected" ? "danger" : "warn"}
                >
                  {labelize(r.approval_status)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
