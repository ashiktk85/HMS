import type { SupabaseClient } from "@supabase/supabase-js";
import { rel } from "@/lib/types";

export type StayRow = {
  booking_code: string;
  check_in_date: string;
  check_out_date: string;
  rooms: { room_number: string } | { room_number: string }[] | null;
};

/** Everything the printed invoice and the PDF show, loaded once. Returns null when the invoice is not found. */
export async function loadInvoiceDocument(supabase: SupabaseClient, id: string) {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, bookings(booking_code, check_in_date, check_out_date, rooms(room_number))")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return null;

  // Every booking on this invoice (several when one guest's rooms are billed together).
  const { data: links } = await supabase
    .from("invoice_bookings")
    .select("booking_id, bookings(booking_code, check_in_date, check_out_date, rooms(room_number))")
    .eq("invoice_id", id);
  const linkedStays = (links || [])
    .map((l) => rel(l.bookings as unknown as StayRow | StayRow[] | null))
    .filter((s): s is StayRow => !!s);
  const bookingIds = [...new Set([invoice.booking_id as string, ...(links || []).map((l) => l.booking_id as string)])];

  const [{ data: items }, { data: taxes }, { data: credits }, { data: settings }, { data: paid }] = await Promise.all([
    supabase.from("invoice_items").select("*").eq("invoice_id", id),
    supabase.from("tax_details").select("*").eq("invoice_id", id).order("tax_name"),
    supabase.from("credit_notes").select("*").eq("invoice_id", id).order("created_at"),
    supabase.from("hotel_settings").select("*").limit(1).maybeSingle(),
    // Payments already received on the booking(s) (advance and later), shown as deductions on the bill.
    supabase
      .from("payments")
      .select("id, amount, method, received_at, notes")
      .in("booking_id", bookingIds)
      .eq("voided", false)
      .order("received_at"),
  ]);

  const paidTotal = (paid || []).reduce((s, p) => s + Number(p.amount), 0);
  const balanceDue = Math.max(Number(invoice.total_amount) - paidTotal, 0);
  const own = rel(invoice.bookings as StayRow | StayRow[] | null);
  const stays = linkedStays.length ? linkedStays : own ? [own] : [];
  const isGst = invoice.invoice_type === "gst";
  const title = invoice.status === "voided" ? "INVOICE (VOID)" : isGst ? "TAX INVOICE" : "BILL OF SUPPLY / INVOICE";

  return { invoice, items: items || [], taxes: taxes || [], credits: credits || [], settings, paid: paid || [], paidTotal, balanceDue, stays, isGst, title };
}

export function advanceLabel(p: { notes: string | null }) {
  return p.notes?.toLowerCase().includes("advance") ? "Advance paid" : "Paid";
}
