import type { SupabaseClient } from "@supabase/supabase-js";

export type Report = {
  from: string;
  to: string;
  days: number;
  rooms: number;
  room_nights_sold: number;
  room_nights_available: number;
  room_revenue: number;
  occupancy_pct: number | null;
  adr: number | null;
  revpar: number | null;
  daily: { date: string; sold: number }[];
  by_room: { room_number: string; type: string; nights: number; revenue: number; occupancy_pct: number }[];
  by_type: { type: string; rooms: number; nights: number; revenue: number; occupancy_pct: number | null; adr: number | null; revpar: number | null }[];
  by_source: { source: string; bookings: number; value: number }[];
  cancellations: { status: string; bookings: number; value: number }[];
  payments_by_method: { method: string; received: number; refunded: number }[];
  received_total: number;
  refunded_total: number;
  expenses_by_category: { category: string; amount: number; count: number }[];
  expenses_total: number;
  gst_invoices: { type: string; count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }[];
  credit_notes: { count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number };
  voided_invoices: number;
  income: number;
  outstanding: { count: number; total: number };
};

export async function loadReport(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<{ report: Report | null; error: string | null }> {
  const { data, error } = await supabase.rpc("hotel_report", { p_from: from, p_to: to });
  if (error) return { report: null, error: error.message };
  return { report: data as Report, error: null };
}
