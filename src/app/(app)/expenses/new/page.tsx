import Link from "next/link";
import { PageHeader, Panel, EmptyState, Field, inputCls, btnPrimary } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/dates";
import { createExpense } from "../actions";

export default async function NewExpensePage() {
  const supabase = await createClient();
  const [{ data: categories }, { data: methods }, { data: settings }] = await Promise.all([
    supabase.from("expense_categories").select("id, name").eq("is_active", true).order("name"),
    supabase.from("payment_methods").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("hotel_settings").select("require_expense_approval").limit(1).maybeSingle(),
  ]);
  const today = todayLocal();

  return (
    <div>
      <PageHeader
        title="New expense"
        description="One entry updates the paying account, the expense report and Profit & Loss."
        actions={
          <Link href="/expenses" className="text-sm font-medium text-[var(--brand)] hover:underline">
            Back
          </Link>
        }
      />
      <Panel>
        {!categories?.length || !methods?.length ? (
          <EmptyState message="Expense categories and payment methods must be set up in Settings first." />
        ) : (
          <ActionForm action={createExpense} className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select name="category_id" required defaultValue="" className={inputCls}>
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input name="amount" type="number" min="0.01" step="0.01" required className={inputCls} />
            </Field>
            <Field label="Expense date" hint="The date on the bill; cannot be in the future">
              <input name="expense_date" type="date" max={today} defaultValue={today} required className={inputCls} />
            </Field>
            <Field label="Paid by" hint="Decides which account the money comes out of">
              <select name="method_id" required defaultValue={methods[0]?.id} className={inputCls}>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Supplier / payee (optional)">
              <input name="supplier" placeholder="State Electricity Board" className={inputCls} />
            </Field>
            <Field label="Description (optional)">
              <input name="description" placeholder="September electricity bill" className={inputCls} />
            </Field>
            <Field label="Bill or receipt (optional)" hint="PDF, JPG, PNG or WebP, up to 5 MB" className="sm:col-span-2">
              <input name="bill" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-sm" />
            </Field>
            {settings?.require_expense_approval ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2">
                Expense approval is on. This expense will wait for the owner, a manager or the accountant before it
                reaches the accounts.
              </p>
            ) : null}
            <SubmitButton className={`${btnPrimary} sm:col-span-2`} pendingLabel="Saving expense…">
              Save expense
            </SubmitButton>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
