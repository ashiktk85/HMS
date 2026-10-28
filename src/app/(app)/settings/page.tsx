import { PageHeader, Panel, Field, inputCls, btnPrimary, btnSoft } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { getSessionProfile } from "@/lib/auth";
import { canAccessSettings } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { savePaymentMethod, updateHotelSettings } from "./actions";
import { saveExpenseCategory } from "../expenses/actions";

export default async function SettingsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!canAccessSettings(session.role)) {
    return (
      <div>
        <PageHeader title="Settings" description="Restricted to owner and manager." />
        <Panel>
          <p className="text-sm text-[var(--muted)]">
            You do not have permission to view or edit hotel settings.
          </p>
        </Panel>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("hotel_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  const [{ data: methods }, { data: accounts }, { data: categories }] = await Promise.all([
    supabase.from("payment_methods").select("*").order("sort_order").order("name"),
    supabase.from("accounts").select("id, name, kind").eq("is_active", true).neq("kind", "receivable").order("name"),
    supabase.from("expense_categories").select("*").order("name"),
  ]);

  return (
    <div>
      <PageHeader
        title="Hotel settings"
        description="Tax rates, invoice prefixes, and approval rules. Configurable — not hard-coded."
      />
      <Panel>
        <ActionForm action={updateHotelSettings} successMessage="Settings saved" className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["hotel_name", "Hotel name", settings?.hotel_name],
              ["address", "Address", settings?.address],
              ["phone", "Phone", settings?.phone],
              ["email", "Email", settings?.email],
              ["gstin", "Hotel GSTIN", settings?.gstin],
              ["gst_invoice_prefix", "GST invoice prefix (max 4)", settings?.gst_invoice_prefix],
              ["non_gst_invoice_prefix", "Non-GST invoice prefix (max 4)", settings?.non_gst_invoice_prefix],
              ["credit_note_prefix", "Credit note prefix (max 4)", settings?.credit_note_prefix],
              ["cgst_rate", "Room CGST % (same state)", settings?.cgst_rate],
              ["sgst_rate", "Room SGST % (same state)", settings?.sgst_rate],
              ["igst_rate", "Room IGST % (other state)", settings?.igst_rate],
              ["service_gst_rate", "Services GST % (total; split into CGST + SGST, or IGST)", settings?.service_gst_rate],
            ] as const
          ).map(([name, label, value]) => (
            <label key={name} className="block text-sm">
              <span className="text-[var(--muted)]">{label}</span>
              <input
                name={name}
                defaultValue={value ?? ""}
                className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2"
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="require_refund_approval"
              defaultChecked={!!settings?.require_refund_approval}
            />
            Require approval for refunds
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="require_expense_approval"
              defaultChecked={!!settings?.require_expense_approval}
            />
            Require approval for expenses
          </label>
          <div className="md:col-span-2">
            <SubmitButton className={btnPrimary}>Save settings</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel className="mt-6">
        <h3 className="mb-1 font-semibold">Payment methods</h3>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Each method pays into one account, so a payment updates the right balance automatically. Turn a method off
          to hide it without losing past payments.
        </p>
        <ul className="divide-y divide-[var(--line)]">
          {(methods || []).map((m) => (
            <li key={m.id} className="py-3">
              <ActionForm action={savePaymentMethod} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={m.id} />
                <Field label="Method name" className="w-44">
                  <input name="name" defaultValue={m.name} required className={inputCls} />
                </Field>
                <Field label="Pays into account" className="w-44">
                  <select name="account_id" defaultValue={m.account_id} className={inputCls}>
                    {(accounts || []).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-center gap-1 pb-2 text-sm">
                  <input type="checkbox" name="requires_reference" defaultChecked={m.requires_reference} /> Needs reference
                </label>
                <label className="flex items-center gap-1 pb-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={m.is_active} /> Active
                </label>
                <SubmitButton className={btnSoft} pendingLabel="…">Save</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
        <h4 className="mb-2 mt-5 text-sm font-semibold">Add a method</h4>
        <ActionForm action={savePaymentMethod} resetOnSuccess successMessage="Method added" className="flex flex-wrap items-end gap-3">
          <Field label="Method name" className="w-44">
            <input name="name" placeholder="Paytm" required className={inputCls} />
          </Field>
          <Field label="Pays into account" className="w-44">
            <select name="account_id" required defaultValue="" className={inputCls}>
              <option value="">Select account</option>
              {(accounts || []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-1 pb-2 text-sm">
            <input type="checkbox" name="requires_reference" defaultChecked /> Needs reference
          </label>
          <SubmitButton className={btnPrimary}>Add method</SubmitButton>
        </ActionForm>
      </Panel>

      <Panel className="mt-6">
        <h3 className="mb-1 font-semibold">Expense categories</h3>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Used to group expenses and in Profit &amp; Loss. Turn a category off to hide it; past expenses keep it.
        </p>
        <ul className="divide-y divide-[var(--line)]">
          {(categories || []).map((c) => (
            <li key={c.id} className="py-2">
              <ActionForm action={saveExpenseCategory} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Category name" className="w-56">
                  <input name="name" defaultValue={c.name} required className={inputCls} />
                </Field>
                <label className="flex items-center gap-1 pb-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Active
                </label>
                <SubmitButton className={btnSoft} pendingLabel="…">Save</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={saveExpenseCategory} resetOnSuccess successMessage="Category added" className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="New category" className="w-56">
            <input name="name" placeholder="Laundry service" required className={inputCls} />
          </Field>
          <SubmitButton className={btnPrimary}>Add category</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
