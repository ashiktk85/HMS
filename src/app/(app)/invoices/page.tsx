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
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, labelize, rel } from "@/lib/types";

const statusTone = (s: string) =>
  s === "issued" ? ("ok" as const) : s === "voided" ? ("danger" as const) : ("warn" as const);

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  const { q, type, status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("invoices")
    .select("*, guests(full_name), bookings(booking_code)")
    .order("issued_at", { ascending: false })
    .limit(200);
  if (type === "gst" || type === "non_gst") query = query.eq("invoice_type", type);
  if (status && ["issued", "voided", "credited"].includes(status)) query = query.eq("status", status);
  const term = (q || "").replace(/[,()%*\\]/g, " ").trim();
  if (term) query = query.or(`invoice_number.ilike.%${term}%,billing_name.ilike.%${term}%`);

  const { data: invoices } = await query;

  const live = (invoices || []).filter((i) => i.status !== "voided");
  const sum = (k: "taxable_value" | "total_amount") => live.reduce((s, i) => s + Number(i[k]), 0);
  const tax = live.reduce((s, i) => s + Number(i.cgst_amount) + Number(i.sgst_amount) + Number(i.igst_amount), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoice register"
        description="GST and non-GST invoices. Numbers run in sequence per financial year and are never reused."
        actions={
          <Link href="/invoices/new" className={btnPrimary}>
            New invoice
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Taxable value (shown, excl. voided)</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(sum("taxable_value"))}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">GST charged</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(tax)}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Invoice total</p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(sum("total_amount"))}</p>
        </Panel>
      </div>

      <Panel>
        <form className="mb-4 flex flex-wrap gap-2">
          <input name="q" defaultValue={q || ""} placeholder="Search invoice number or name" className={`${inputCls} !w-72`} />
          <select name="type" defaultValue={type || ""} className={`${inputCls} !w-40`} aria-label="Invoice type">
            <option value="">All types</option>
            <option value="gst">GST</option>
            <option value="non_gst">Non-GST</option>
          </select>
          <select name="status" defaultValue={status || ""} className={`${inputCls} !w-40`} aria-label="Status">
            <option value="">All statuses</option>
            <option value="issued">Issued</option>
            <option value="credited">Credited</option>
            <option value="voided">Voided</option>
          </select>
          <button type="submit" className={btnSoft}>Filter</button>
        </form>

        {!invoices?.length ? (
          <EmptyState message={term || type || status ? "No invoices match." : "No invoices yet."} />
        ) : (
          <DataTable
            searchable={false}
            columns={[
              { header: "Invoice" },
              { header: "Type" },
              { header: "Billed to", maxWidth: "16rem" },
              { header: "Booking" },
              { header: "Date" },
              { header: "Taxable", align: "right" },
              { header: "GST", align: "right" },
              { header: "Total", align: "right" },
              { header: "Status" },
            ]}
            rows={invoices.map((i) => ({
              key: i.id,
              details: {
                title: i.invoice_number,
                subtitle: `${labelize(i.invoice_type)} invoice · ${labelize(i.status)}`,
                fields: [
                  { label: "Billed to", value: i.billing_name ?? rel(i.guests as { full_name: string } | { full_name: string }[] | null)?.full_name },
                  { label: "Booking", value: rel(i.bookings as { booking_code: string } | { booking_code: string }[] | null)?.booking_code },
                  { label: "Issued", value: formatDate(i.issued_at) },
                  { label: "Financial year", value: i.fiscal_year },
                  { label: "Customer GSTIN", value: i.customer_gstin },
                  { label: "Supply", value: i.invoice_type === "gst" ? (i.is_inter_state ? "Other state (IGST)" : "Same state (CGST + SGST)") : null },
                  { label: "Taxable value", value: formatMoney(i.taxable_value) },
                  { label: "CGST", value: formatMoney(i.cgst_amount) },
                  { label: "SGST", value: formatMoney(i.sgst_amount) },
                  { label: "IGST", value: formatMoney(i.igst_amount) },
                  { label: "Total", value: formatMoney(i.total_amount) },
                  { label: "Billing address", value: i.billing_address, wide: true },
                  { label: "Note", value: i.notes, wide: true },
                  ...(i.status === "voided" ? [{ label: "Void reason", value: i.void_reason, wide: true }] : []),
                ],
                actions: (
                  <>
                    <Link href={`/invoices/${i.id}`} className={btnPrimary}>Open invoice</Link>
                    <a href={`/print/invoices/${i.id}/pdf`} className={btnSoft}>Download PDF</a>
                  </>
                ),
              },
              cells: [
                <Link key="n" href={`/invoices/${i.id}`} className="font-medium text-[var(--brand)] hover:underline">
                  {i.invoice_number}
                </Link>,
                labelize(i.invoice_type),
                i.billing_name ?? rel(i.guests as { full_name: string } | { full_name: string }[] | null)?.full_name,
                rel(i.bookings as { booking_code: string } | { booking_code: string }[] | null)?.booking_code,
                formatDate(i.issued_at),
                formatMoney(i.taxable_value),
                formatMoney(Number(i.cgst_amount) + Number(i.sgst_amount) + Number(i.igst_amount)),
                <span key="t" className="font-medium">{formatMoney(i.total_amount)}</span>,
                <StatusPill key="s" tone={statusTone(i.status)}>{labelize(i.status)}</StatusPill>,
              ],
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
