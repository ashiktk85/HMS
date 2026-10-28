import Link from "next/link";
import { PageHeader, Panel, btnSoft } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { addDays, isMonthString, monthLabel, monthRange, todayLocal } from "@/lib/dates";
import { formatMoney, rel } from "@/lib/types";

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${strong ? "font-semibold" : ""} ${muted ? "text-[var(--muted)]" : ""}`}>
      <span>{label}</span>
      <span>{formatMoney(value)}</span>
    </div>
  );
}

/** Start of a hotel-local date as an ISO timestamp (India is UTC+05:30). */
const istStart = (date: string) => `${date}T00:00:00+05:30`;

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const month = isMonthString(monthParam) ? monthParam : todayLocal().slice(0, 7);
  const { from, to } = monthRange(month);
  const supabase = await createClient();

  const [{ data: invoices }, { data: credits }, { data: expenses }, { data: uninvoiced }, { data: cash }] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("invoice_type, taxable_value, cgst_amount, sgst_amount, igst_amount")
        .in("status", ["issued", "credited"])
        .gte("issued_at", istStart(from))
        .lt("issued_at", istStart(to)),
      supabase
        .from("credit_notes")
        .select("taxable_value, cgst_amount, sgst_amount, igst_amount")
        .gte("created_at", istStart(from))
        .lt("created_at", istStart(to)),
      supabase
        .from("expenses")
        .select("amount, expense_categories(name)")
        .eq("posted", true)
        .eq("reversed", false)
        .gte("expense_date", from)
        .lt("expense_date", to),
      supabase
        .from("bookings")
        .select("id, subtotal, invoices(status)")
        .eq("status", "checked_out")
        .gte("check_out_date", from)
        .lt("check_out_date", to),
      supabase
        .from("account_transactions")
        .select("txn_type, amount, reference_type")
        .gte("created_at", istStart(from))
        .lt("created_at", istStart(to)),
    ]);

  const sum = <T,>(rows: T[] | null, f: (r: T) => number) => (rows || []).reduce((s, r) => s + f(r), 0);

  // Revenue = taxable value of invoices issued this month, less credit notes raised this month.
  // GST collected is owed to the government, so it is shown separately and not counted as income.
  const roomRevenue = sum(invoices, (i) => Number(i.taxable_value));
  const credited = sum(credits, (c) => Number(c.taxable_value));
  const revenue = roomRevenue - credited;
  const gstCollected =
    sum(invoices, (i) => Number(i.cgst_amount) + Number(i.sgst_amount) + Number(i.igst_amount)) -
    sum(credits, (c) => Number(c.cgst_amount) + Number(c.sgst_amount) + Number(c.igst_amount));

  const byCategory = new Map<string, number>();
  for (const e of expenses || []) {
    const name = rel(e.expense_categories as { name: string } | { name: string }[] | null)?.name ?? "Other";
    byCategory.set(name, (byCategory.get(name) ?? 0) + Number(e.amount));
  }
  const totalExpenses = sum(expenses, (e) => Number(e.amount));
  const profit = revenue - totalExpenses;

  const notInvoiced = (uninvoiced || []).filter(
    (b) => !((b.invoices as { status: string }[] | null) || []).some((i) => ["issued", "credited"].includes(i.status)),
  );
  const notInvoicedTotal = sum(notInvoiced, (b) => Number(b.subtotal));

  const signed = (t: { txn_type: string; amount: number }) => (t.txn_type === "credit" ? 1 : -1) * Number(t.amount);
  const cashIn = sum((cash || []).filter((t) => ["payment", "payment_void", "refund"].includes(t.reference_type ?? "")), signed);
  const cashOut = -sum((cash || []).filter((t) => ["expense", "expense_reversal"].includes(t.reference_type ?? "")), signed);

  const prev = addDays(from, -1).slice(0, 7);
  const next = to.slice(0, 7);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & Loss"
        description="Income is the taxable value of invoices issued in the month. Expenses are posted expenses dated in the month."
        actions={
          <>
            <Link href="/accounts" className={btnSoft}>Accounts</Link>
            <Link href="/expenses" className={btnSoft}>Expenses</Link>
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Link href={`/accounts/pnl?month=${prev}`} className={btnSoft}>←</Link>
        <span className="min-w-40 text-center font-semibold">{monthLabel(month)}</span>
        <Link href={`/accounts/pnl?month=${next}`} className={btnSoft}>→</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Income</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{formatMoney(revenue)}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Expenses</p>
          <p className="mt-1 text-2xl font-semibold text-rose-700">{formatMoney(totalExpenses)}</p>
        </Panel>
        <Panel className="bg-[var(--brand-tint)]">
          <p className="text-xs uppercase text-[var(--muted)]">{profit >= 0 ? "Net profit" : "Net loss"}</p>
          <p className={`mt-1 text-2xl font-semibold ${profit >= 0 ? "" : "text-rose-700"}`}>{formatMoney(profit)}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-2 font-semibold">Statement</h3>
          <div className="divide-y divide-[var(--line)] text-sm">
            <div>
              <Row label="Invoiced (before GST)" value={roomRevenue} />
              <Row label="Less credit notes" value={-credited} />
              <Row label="Income" value={revenue} strong />
            </div>
            <div className="pt-2">
              {[...byCategory.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, amt]) => (
                  <Row key={name} label={name} value={-amt} />
                ))}
              <Row label="Total expenses" value={-totalExpenses} strong />
            </div>
            <div className="pt-2">
              <Row label={profit >= 0 ? "Net profit" : "Net loss"} value={profit} strong />
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <h3 className="mb-2 font-semibold">Not in the figures above</h3>
            <div className="text-sm">
              <Row label="GST collected (owed to government)" value={gstCollected} muted />
              <Row label={`Checked-out stays not yet invoiced (${notInvoiced.length})`} value={notInvoicedTotal} muted />
            </div>
            {notInvoiced.length ? (
              <p className="mt-2 text-xs text-amber-800">
                Invoice these stays so their income appears in Profit &amp; Loss.{" "}
                <Link href="/invoices/new" className="font-medium underline">Create invoice</Link>
              </p>
            ) : null}
          </Panel>
          <Panel>
            <h3 className="mb-2 font-semibold">Cash view</h3>
            <div className="text-sm">
              <Row label="Received from guests (net of refunds and voids)" value={cashIn} />
              <Row label="Paid out for expenses (net of reversals)" value={-cashOut} />
              <Row label="Net cash movement" value={cashIn - cashOut} strong />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Money actually received and paid this month, which can differ from income and expenses above.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
