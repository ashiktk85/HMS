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
import { addDays, isMonthString, monthLabel as labelForMonth, monthRange, todayLocal } from "@/lib/dates";
import { expenseState, formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { decideExpense } from "./actions";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string }>;
}) {
  const { month: monthParam, category } = await searchParams;
  const month = isMonthString(monthParam) ? monthParam : todayLocal().slice(0, 7);
  const { from, to } = monthRange(month);

  const session = await getSessionProfile();
  const canDecide = ["owner", "manager", "accountant"].includes(session?.role ?? "");
  const supabase = await createClient();

  let query = supabase
    .from("expenses")
    .select("*, expense_categories(name)")
    .gte("expense_date", from)
    .lt("expense_date", to)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (category) query = query.eq("category_id", category);

  const [{ data: expenses }, { data: categories }, { data: pending }] = await Promise.all([
    query,
    supabase.from("expense_categories").select("id, name").order("name"),
    supabase
      .from("expenses")
      .select("*, expense_categories(name)")
      .eq("approval_status", "pending")
      .order("created_at"),
  ]);

  const posted = (expenses || []).filter((e) => e.posted && !e.reversed);
  const total = posted.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = new Map<string, number>();
  for (const e of posted) {
    const name = rel(e.expense_categories as { name: string } | null)?.name ?? "Other";
    byCategory.set(name, (byCategory.get(name) ?? 0) + Number(e.amount));
  }

  const prevMonth = addDays(from, -1).slice(0, 7);
  const nextMonth = to.slice(0, 7);
  const monthLabel = labelForMonth(month);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Each expense is taken out of the paying account and counted in Profit & Loss."
        actions={
          <>
            <Link href="/accounts/pnl" className={btnSoft}>
              Profit &amp; Loss
            </Link>
            <Link href="/expenses/new" className={btnPrimary}>
              New expense
            </Link>
          </>
        }
      />

      {pending?.length ? (
        <Panel className="border-amber-200 bg-amber-50/60">
          <h3 className="mb-3 font-semibold">Waiting for approval ({pending.length})</h3>
          <ul className="space-y-3 text-sm">
            {pending.map((e) => (
              <li key={e.id} className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Link href={`/expenses/${e.id}`} className="font-medium text-[var(--brand)] hover:underline">
                    {formatMoney(e.amount)} · {rel(e.expense_categories as { name: string } | null)?.name}
                  </Link>
                  <p className="text-[var(--muted)]">
                    {e.supplier || "No payee"} · {e.payment_method} · {formatDate(e.expense_date)}
                  </p>
                </div>
                {canDecide ? (
                  <ActionForm action={decideExpense} className="flex flex-wrap items-center gap-2" successMessage="Done">
                    <input type="hidden" name="expense_id" value={e.id} />
                    <input name="note" placeholder="Note (optional)" aria-label="Decision note" className={`${inputCls} !w-40 !py-1 text-xs`} />
                    <SubmitButton name="decision" value="approve" className={`${btnPrimary} !py-1 text-xs`} pendingLabel="…">
                      Approve
                    </SubmitButton>
                    <SubmitButton name="decision" value="reject" className="rounded-xl border border-[var(--line)] bg-white px-3 py-1 text-xs font-medium hover:bg-rose-50" pendingLabel="…">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <span className="text-xs text-[var(--muted)]">Owner, manager or accountant must approve.</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/expenses?month=${prevMonth}${category ? `&category=${category}` : ""}`} className={btnSoft}>
          ←
        </Link>
        <span className="min-w-36 text-center font-semibold">{monthLabel}</span>
        <Link href={`/expenses?month=${nextMonth}${category ? `&category=${category}` : ""}`} className={btnSoft}>
          →
        </Link>
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="month" value={month} />
          <select name="category" defaultValue={category ?? ""} aria-label="Category" className={`${inputCls} !w-48`}>
            <option value="">All categories</option>
            {(categories || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="submit" className={btnSoft}>Filter</button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Posted this month</p>
          <p className="mt-1 text-2xl font-semibold text-rose-700">{formatMoney(total)}</p>
          <ul className="mt-4 space-y-1 text-sm">
            {[...byCategory.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, amt]) => (
                <li key={name} className="flex justify-between">
                  <span className="text-[var(--muted)]">{name}</span>
                  <span>{formatMoney(amt)}</span>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel className="lg:col-span-2">
          {!expenses?.length ? (
            <EmptyState message="No expenses in this month." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[var(--muted)]">
                  <tr>
                    <th className="py-2 font-medium">Date</th>
                    <th className="font-medium">Category</th>
                    <th className="font-medium">Payee</th>
                    <th className="font-medium">Paid by</th>
                    <th className="text-right font-medium">Amount</th>
                    <th className="font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => {
                    const st = expenseState(e);
                    return (
                      <tr key={e.id} className="border-t border-[var(--line)]">
                        <td className="whitespace-nowrap py-3">
                          <Link href={`/expenses/${e.id}`} className="font-medium text-[var(--brand)] hover:underline">
                            {formatDate(e.expense_date)}
                          </Link>
                        </td>
                        <td>{rel(e.expense_categories as { name: string } | null)?.name}</td>
                        <td>{e.supplier || "—"}</td>
                        <td>{e.payment_method}</td>
                        <td className={`text-right ${e.reversed ? "text-[var(--muted)] line-through" : ""}`}>
                          {formatMoney(e.amount)}
                        </td>
                        <td>
                          <StatusPill tone={st.tone}>{labelize(st.label)}</StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
