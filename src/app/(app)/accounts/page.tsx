import { PageHeader, Panel, EmptyState, StatusPill, btnPrimary, btnSoft } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/dates";
import { DataTable } from "@/components/DataTable";
import { bookingLabel, bookingTone, formatDate, formatMoney, rel } from "@/lib/types";
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
          <DataTable
            searchPlaceholder="Search booking or guest"
            columns={[
              { header: "Booking" },
              { header: "Guest", maxWidth: "18rem" },
              { header: "Status" },
              { header: "Balance due", align: "right" },
              { header: "", align: "right" },
            ]}
            filters={[
              {
                key: "status",
                label: "All statuses",
                options: [...new Set(outstanding.map((b) => b.status))].map((s) => ({ value: s, label: bookingLabel(s) })),
              },
            ]}
            rows={outstanding.map((b) => {
              const guest = rel(b.guests as { full_name: string } | { full_name: string }[] | null)?.full_name;
              return {
                key: b.id,
                details: {
                  title: b.booking_code,
                  subtitle: `${guest ?? "Guest"} · ${bookingLabel(b.status)}`,
                  fields: [
                    { label: "Guest", value: guest },
                    { label: "Status", value: bookingLabel(b.status) },
                    { label: "Balance due", value: formatMoney(b.balance_due) },
                  ],
                  actions: (
                    <>
                      <Link href={`/payments/new?booking_id=${b.id}`} className={btnPrimary}>Record payment</Link>
                      <Link href={`/bookings/${b.id}`} className={btnSoft}>Open booking</Link>
                    </>
                  ),
                },
                search: `${b.booking_code} ${guest ?? ""}`,
                filter: { status: b.status },
                cells: [
                  <Link key="b" href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                    {b.booking_code}
                  </Link>,
                  guest,
                  <StatusPill key="s" tone={bookingTone(b.status)}>{bookingLabel(b.status)}</StatusPill>,
                  <span key="d" className="font-medium">{formatMoney(b.balance_due)}</span>,
                  <Link key="p" href={`/payments/new?booking_id=${b.id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">
                    Record payment
                  </Link>,
                ],
              };
            })}
          />
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
          <DataTable
            searchPlaceholder="Search description, booking"
            columns={[
              { header: "When" },
              { header: "Account" },
              { header: "Source" },
              { header: "Booking" },
              { header: "Description", maxWidth: "22rem" },
              { header: "In", align: "right" },
              { header: "Out", align: "right" },
            ]}
            filters={[
              {
                key: "source",
                label: "All sources",
                options: [...new Set(txns.map((t) => t.reference_type ?? ""))]
                  .filter(Boolean)
                  .map((s) => ({ value: s, label: SOURCE_LABEL[s] ?? s })),
              },
            ]}
            rows={txns.map((t) => {
              const code = rel(t.bookings as { booking_code: string } | { booking_code: string }[] | null)?.booking_code;
              const source = SOURCE_LABEL[t.reference_type ?? ""] ?? t.reference_type;
              return {
                key: t.id,
                details: {
                  title: `${t.txn_type === "credit" ? "Money in" : "Money out"} · ${formatMoney(t.amount)}`,
                  subtitle: formatDate(t.created_at),
                  fields: [
                    { label: "Account", value: rel(t.accounts as { name: string } | { name: string }[] | null)?.name },
                    { label: "Type", value: t.txn_type === "credit" ? "In (credit)" : "Out (debit)" },
                    { label: "Amount", value: formatMoney(t.amount) },
                    { label: "Source", value: source },
                    { label: "Booking", value: code },
                    { label: "When", value: formatDate(t.created_at) },
                    { label: "Description", value: t.description, wide: true },
                  ],
                  actions:
                    t.reference_type === "payment" && t.reference_id ? (
                      <Link href={`/payments/${t.reference_id}`} className={btnPrimary}>Open payment</Link>
                    ) : null,
                },
                search: `${t.description ?? ""} ${code ?? ""} ${source ?? ""}`,
                filter: { source: t.reference_type ?? "" },
                cells: [
                  formatDate(t.created_at),
                  rel(t.accounts as { name: string } | { name: string }[] | null)?.name,
                  <span key="s">
                    {source}
                    {t.reference_type === "payment" && t.reference_id ? (
                      <Link href={`/payments/${t.reference_id}`} className="ml-1 text-[var(--brand)] hover:underline">
                        view
                      </Link>
                    ) : null}
                  </span>,
                  code ?? "—",
                  t.description,
                  t.txn_type === "credit" ? <span key="i" className="text-emerald-700">{formatMoney(t.amount)}</span> : "",
                  t.txn_type === "debit" ? <span key="o" className="text-rose-700">{formatMoney(t.amount)}</span> : "",
                ],
              };
            })}
          />
        )}
      </Panel>
    </div>
  );
}
