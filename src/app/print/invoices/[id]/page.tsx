import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { amountInWords } from "@/lib/words";
import { PrintButton } from "@/components/PrintButton";
import { notFound } from "next/navigation";

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, bookings(booking_code, check_in_date, check_out_date, rooms(room_number))")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) notFound();

  const [{ data: items }, { data: taxes }, { data: credits }, { data: settings }] = await Promise.all([
    supabase.from("invoice_items").select("*").eq("invoice_id", id),
    supabase.from("tax_details").select("*").eq("invoice_id", id).order("tax_name"),
    supabase.from("credit_notes").select("*").eq("invoice_id", id).order("created_at"),
    supabase.from("hotel_settings").select("*").limit(1).maybeSingle(),
  ]);

  type Booking = {
    booking_code: string;
    check_in_date: string;
    check_out_date: string;
    rooms: { room_number: string } | { room_number: string }[] | null;
  };
  const booking = rel(invoice.bookings as Booking | Booking[] | null);
  const room = rel(booking?.rooms ?? null);
  const isGst = invoice.invoice_type === "gst";
  const title = invoice.status === "voided" ? "INVOICE (VOID)" : isGst ? "TAX INVOICE" : "BILL OF SUPPLY / INVOICE";

  return (
    <div className="min-h-screen bg-white p-8 text-black">
      <div className="mx-auto max-w-3xl text-sm">
        <div className="no-print mb-6 flex items-center justify-between">
          <p className="text-xs text-stone-500">Use Print, then choose “Save as PDF” to download a PDF.</p>
          <PrintButton />
        </div>

        {invoice.status === "voided" ? (
          <p className="mb-4 border border-red-400 p-2 text-center font-semibold text-red-700">
            VOIDED{invoice.void_reason ? `: ${invoice.void_reason}` : ""}. This invoice is not valid.
          </p>
        ) : null}

        <div className="mb-6 flex justify-between border-b border-stone-300 pb-4">
          <div>
            <h1 className="text-xl font-semibold">{settings?.hotel_name}</h1>
            {settings?.address ? <p>{settings.address}</p> : null}
            {settings?.phone ? <p>Phone: {settings.phone}</p> : null}
            {settings?.email ? <p>{settings.email}</p> : null}
            {isGst && invoice.hotel_gstin ? <p className="font-medium">GSTIN: {invoice.hotel_gstin}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{title}</p>
            <p className="font-medium">{invoice.invoice_number}</p>
            <p>Date: {formatDate(invoice.issued_at)}</p>
            <p>Booking: {booking?.booking_code}</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs uppercase text-stone-500">Billed to</p>
            <p className="font-medium">{invoice.billing_name}</p>
            {invoice.billing_address ? <p>{invoice.billing_address}</p> : null}
            {isGst && invoice.customer_gstin ? <p>GSTIN: {invoice.customer_gstin}</p> : null}
          </div>
          <div>
            <p className="text-xs uppercase text-stone-500">Stay</p>
            <p>
              {booking?.check_in_date} to {booking?.check_out_date}
              {room ? ` · Room ${room.room_number}` : ""}
            </p>
            {isGst ? (
              <p>Supply: {invoice.is_inter_state ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</p>
            ) : null}
          </div>
        </div>

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-stone-400 text-xs uppercase">
              <th className="py-2">Description</th>
              {isGst ? <th>SAC</th> : null}
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              {isGst ? <th className="text-right">GST %</th> : null}
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((it) => (
              <tr key={it.id} className="border-b border-stone-200">
                <td className="py-2">{it.description}</td>
                {isGst ? <td>{it.sac_code || ""}</td> : null}
                <td className="text-right">{it.quantity}</td>
                <td className="text-right">{formatMoney(it.unit_amount)}</td>
                {isGst ? <td className="text-right">{it.tax_rate}%</td> : null}
                <td className="text-right">{formatMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 max-w-xs space-y-1">
          <div className="flex justify-between">
            <dt>{isGst ? "Taxable value" : "Sub-total"}</dt>
            <dd>{formatMoney(invoice.taxable_value)}</dd>
          </div>
          {(taxes || []).map((t) => (
            <div key={t.id} className="flex justify-between">
              <dt>
                {t.tax_name} @ {t.rate}%
              </dt>
              <dd>{formatMoney(t.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-400 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatMoney(invoice.total_amount)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs">{amountInWords(Number(invoice.total_amount))}</p>

        {credits?.length ? (
          <div className="mt-6 border-t border-stone-300 pt-3 text-xs">
            <p className="font-semibold uppercase">Credit notes against this invoice</p>
            {credits.map((c) => (
              <p key={c.id}>
                {c.credit_note_number} · {formatDate(c.created_at)} · {formatMoney(c.amount)}
                {c.reason ? ` · ${c.reason}` : ""}
              </p>
            ))}
          </div>
        ) : null}

        {invoice.notes ? <p className="mt-4 text-xs">Note: {invoice.notes}</p> : null}
        <p className="mt-10 text-center text-xs text-stone-500">
          {isGst ? `${labelize(invoice.invoice_type)} invoice` : "No GST charged"} · This is a computer-generated invoice.
        </p>
      </div>
    </div>
  );
}
