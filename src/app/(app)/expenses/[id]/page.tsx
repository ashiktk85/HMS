import Link from "next/link";
import { PageHeader, Panel, StatusPill, Field, inputCls, btnPrimary, btnSoft } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { expenseState, formatDate, formatMoney, rel } from "@/lib/types";
import { notFound } from "next/navigation";
import { decideExpense, reverseExpense } from "../actions";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  const canManage = ["owner", "manager", "accountant"].includes(session?.role ?? "");
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("expenses")
    .select("*, expense_categories(name), accounts(name), profiles!expenses_created_by_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();

  // Storage is private: a short-lived signed link lets staff open the bill.
  const bill = e.bill_path
    ? (await supabase.storage.from("expense-receipts").createSignedUrl(e.bill_path, 3600)).data?.signedUrl
    : null;
  const st = expenseState(e);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${formatMoney(e.amount)} · ${rel(e.expense_categories as { name: string } | null)?.name}`}
        description={`${e.supplier || "No payee"} · ${formatDate(e.expense_date)}`}
        actions={
          <Link href="/expenses" className={btnSoft}>
            All expenses
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4">
            <StatusPill tone={st.tone}>{st.label}</StatusPill>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              ["Amount", formatMoney(e.amount)],
              ["Expense date", formatDate(e.expense_date)],
              ["Category", rel(e.expense_categories as { name: string } | null)?.name],
              ["Payee", e.supplier || "—"],
              ["Paid by", e.payment_method],
              ["Account", rel(e.accounts as { name: string } | null)?.name],
              ["Recorded by", rel(e.profiles as { full_name: string } | null)?.full_name ?? "—"],
              ["Recorded", dateTime.format(new Date(e.created_at))],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-[var(--muted)]">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {e.description ? <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm">{e.description}</p> : null}
          {e.decision_note ? (
            <p className="mt-3 text-sm text-[var(--muted)]">Approval note: {e.decision_note}</p>
          ) : null}
          {e.reversed ? (
            <p className="mt-4 rounded-xl bg-stone-100 p-3 text-sm">
              Reversed {e.reversed_at ? dateTime.format(new Date(e.reversed_at)) : ""}: {e.reverse_reason}. The amount
              was put back into the account.
            </p>
          ) : null}
          <div className="mt-4">
            {bill ? (
              <a href={bill} target="_blank" rel="noreferrer" className={btnSoft}>
                Open bill / receipt
              </a>
            ) : (
              <p className="text-sm text-[var(--muted)]">No bill attached.</p>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          {e.approval_status === "pending" && canManage ? (
            <Panel>
              <h3 className="mb-3 font-semibold">Approve or reject</h3>
              <ActionForm action={decideExpense} className="grid gap-3" successMessage="Done">
                <input type="hidden" name="expense_id" value={e.id} />
                <Field label="Note (optional)">
                  <input name="note" className={inputCls} />
                </Field>
                <div className="flex gap-2">
                  <SubmitButton name="decision" value="approve" className={btnPrimary}>
                    Approve and post
                  </SubmitButton>
                  <SubmitButton
                    name="decision"
                    value="reject"
                    className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-medium hover:bg-rose-50"
                  >
                    Reject
                  </SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          ) : null}

          {e.posted && !e.reversed && canManage ? (
            <Panel>
              <h3 className="mb-1 font-semibold">Reverse this expense</h3>
              <p className="mb-3 text-sm text-[var(--muted)]">
                For a wrong entry. The expense stays on record as reversed, the amount goes back into{" "}
                {rel(e.accounts as { name: string } | null)?.name}, and it drops out of Profit &amp; Loss. Then record
                the correct expense.
              </p>
              <ActionForm action={reverseExpense} successMessage="Expense reversed" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="expense_id" value={e.id} />
                <Field label="Reason (required)" className="min-w-56 flex-1">
                  <input name="reason" required placeholder="Entered twice" className={inputCls} />
                </Field>
                <SubmitButton className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100">
                  Reverse
                </SubmitButton>
              </ActionForm>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
