import { PageHeader, Panel, EmptyState, StatusPill, btnPrimary, btnSoft } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/dates";
import { bookingTone, formatDate, formatMoney, labelize, rel } from "@/lib/types";
import Link from "next/link";

const SOURCE_LABEL: Record<string, string> = {
  payment: "Payment",
  payment_void: "Payment voided",
  refund: "Refund",
  expense: "Expense",
  expense_reversal: "Expense reversed",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account } = await searchParams;
  const monthStart = `${todayLocal().slice(0, 8)}01`;
  const supabase = await createClient();

  let txnQuery = supabase
    .from("account_transactions")
    .select("*, accounts(name), bookings(booking_code)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (account) txnQuery = txnQuery.eq("account_id", account);

  const [{ data: accounts }, { data: txns }, { data: outstanding }, { data: monthTx }, { data: expenseRows }] =
    await Promise.all([
      supabase.from("accounts").select("*").neq("kind", "receivable").order("name"),
      txnQuery,
      supabase
        .from("bookings")
        .select("id, booking_code, status, balance_due, check_out_date, guests(full_name)")
        .gt("balance_due", 0)
        .in("status", ["hold", "confirmed", "checked_in", "checked_out"])
        .order("balance_due", { ascending: false }),
      supabase
        .from("account_transactions")
        .select("txn_type, amount, reference_type")
        .in("reference_type", ["payment", "payment_void", "refund"])
        .gte("created_at", monthStart),
      supabase.from("expenses").select("amount").eq("posted", true).eq("reversed", false).gte("expense_date", monthStart),
    ]);

  // Net receipts: money in from payments, minus refunds and voided payments.
  const income = (monthTx || []).reduce(
    (s, t) => s + (t.txn_type === "credit" ? Number(t.amount) : -Number(t.amount)),
    0,
  );
  const expenses = (expenseRows || []).reduce((s, e) => s + Number(e.amount), 0);
  const receivable = (outstanding || []).reduce((s, b) => s + Number(b.balance_due), 0);
  const totalBalance = (accounts || []).reduce((s, a) => s + Number(a.balance), 0);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      active
        ? "bg-[var(--brand-soft)] text-[var(--brand)]"
        : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--brand-tint)]"
    }`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Money held in each account, what guests still owe, and this month's net receipts."
        actions={
          <>
            <Link href="/payments" className={btnSoft}>
              Payments
            </Link>
            <Link href="/payments/new" className={btnPrimary}>
              Record payment
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(accounts || []).map((a) => (
          <Link key={a.id} href={`/accounts?account=${a.id}`}>
            <Panel className="h-full transition hover:border-[var(--brand)]">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{a.name}</p>
              <p className="mt-1 text-2xl font-semibold">{formatMoney(a.balance)}</p>
            </Panel>
          </Link>
        ))}
        <Panel className="bg-[var(--brand-tint)]">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">All accounts</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(totalBalance)}</p>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Net receipts this month</p>
          <p className="mt-1 text-xl font-semibold text-emerald-700">{formatMoney(income)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Payments minus refunds and voids</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Expenses this month</p>
          <p className="mt-1 text-xl font-semibold text-rose-700">{formatMoney(expenses)}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Receipts − expenses</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(income - expenses)}</p>
          <Link href="/accounts/pnl" className="mt-1 inline-block text-xs font-medium text-[var(--brand)] hover:underline">Open Profit &amp; Loss</Link>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Owed by guests</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(receivable)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{outstanding?.length ?? 0} booking(s)</p>
        </Panel>
      </div>

      <Panel>
        <h3 className="mb-3 font-semibold">Outstanding balances</h3>
        {!outstanding?.length ? (
          <EmptyState message="No outstanding balances." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Booking</th>
                  <th className="font-medium">Guest</th>
                  <th className="font-medium">Status</th>
                  <th className="text-right font-medium">Balance due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {outstanding.map((b) => (
                  <tr key={b.id} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      <Link href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                        {b.booking_code}
                      </Link>
                    </td>
                    <td>
                      {rel(b.guests as { full_name: string } | { full_name: string }[] | null)?.full_name}
                    </td>
                    <td>
                      <StatusPill tone={bookingTone(b.status)}>{labelize(b.status)}</StatusPill>
                    </td>
                    <td className="text-right font-medium">{formatMoney(b.balance_due)}</td>
                    <td className="text-right">
                      <Link href={`/payments/new?booking_id=${b.id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">
                        Record payment
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-2 font-semibold">Account transactions</h3>
          <Link href="/accounts" className={chip(!account)}>
            All
          </Link>
          {(accounts || []).map((a) => (
            <Link key={a.id} href={`/accounts?account=${a.id}`} className={chip(account === a.id)}>
              {a.name}
            </Link>
          ))}
        </div>
        {!txns?.length ? (
          <EmptyState message="No transactions yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">When</th>
                  <th className="font-medium">Account</th>
                  <th className="font-medium">Source</th>
                  <th className="font-medium">Description</th>
                  <th className="text-right font-medium">In</th>
                  <th className="text-right font-medium">Out</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--line)]">
                    <td className="whitespace-nowrap py-2">{formatDate(t.created_at)}</td>
                    <td>{rel(t.accounts as { name: string } | { name: string }[] | null)?.name}</td>
                    <td>
                      {SOURCE_LABEL[t.reference_type ?? ""] ?? t.reference_type}
                      {t.reference_type === "payment" && t.reference_id ? (
                        <Link href={`/payments/${t.reference_id}`} className="ml-1 text-[var(--brand)] hover:underline">
                          view
                        </Link>
                      ) : null}
                    </td>
                    <td>
                      {t.description}
                      <span className="block text-xs text-[var(--muted)]">
                        {rel(t.bookings as { booking_code: string } | { booking_code: string }[] | null)?.booking_code}
                      </span>
                    </td>
                    <td className="text-right text-emerald-700">
                      {t.txn_type === "credit" ? formatMoney(t.amount) : ""}
                    </td>
                    <td className="text-right text-rose-700">
                      {t.txn_type === "debit" ? formatMoney(t.amount) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
