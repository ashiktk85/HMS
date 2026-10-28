import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { isDateString } from "@/lib/dates";
import { loadReport } from "@/lib/report";
import { labelize } from "@/lib/types";

export const dynamic = "force-dynamic";

const MONEY = '#,##0.00;[Red]-#,##0.00';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isDateString(from) || !isDateString(to)) {
    return new Response("Choose a valid date range", { status: 400 });
  }

  const { report: r, error } = await loadReport(supabase, from, to);
  if (error || !r) return new Response(error ?? "Report failed", { status: 400 });

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const sheet = (name: string, head: string[], rows: (string | number | null)[][], moneyCols: number[] = []) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(head).font = { bold: true };
    rows.forEach((row) => ws.addRow(row));
    ws.columns.forEach((col, i) => {
      col.width = Math.max(14, head[i]?.length + 4 || 14);
      if (moneyCols.includes(i)) col.numFmt = MONEY;
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };

  sheet(
    "Summary",
    ["Measure", "Value"],
    [
      ["From", r.from],
      ["To", r.to],
      ["Days", r.days],
      ["Active rooms", r.rooms],
      ["Room nights sold", r.room_nights_sold],
      ["Room nights available", r.room_nights_available],
      ["Occupancy %", r.occupancy_pct],
      ["ADR", r.adr],
      ["RevPAR", r.revpar],
      ["Room revenue", r.room_revenue],
      ["Income (invoiced, before GST)", r.income],
      ["Expenses", r.expenses_total],
      ["Profit / loss", r.income - r.expenses_total],
      ["Payments received", r.received_total],
      ["Refunds paid", r.refunded_total],
      ["Outstanding from guests (now)", r.outstanding.total],
    ],
    [1],
  );
  sheet("Room types", ["Type", "Rooms", "Nights", "Occupancy %", "ADR", "RevPAR", "Revenue"],
    r.by_type.map((t) => [t.type, t.rooms, t.nights, t.occupancy_pct, t.adr, t.revpar, t.revenue]), [4, 5, 6]);
  sheet("Rooms", ["Room", "Type", "Nights", "Occupancy %", "Revenue"],
    r.by_room.map((x) => [x.room_number, x.type, x.nights, x.occupancy_pct, x.revenue]), [4]);
  sheet("Payments", ["Method", "Received", "Refunded", "Net"],
    r.payments_by_method.map((p) => [p.method, p.received, p.refunded, p.received - p.refunded]), [1, 2, 3]);
  sheet("Expenses", ["Category", "Entries", "Amount"],
    r.expenses_by_category.map((e) => [e.category, e.count, e.amount]), [2]);
  sheet("GST", ["Type", "Count", "Taxable", "CGST", "SGST", "IGST", "Total"], [
    ...r.gst_invoices.map((g) => [labelize(g.type), g.count, g.taxable, g.cgst, g.sgst, g.igst, g.total]),
    ["Credit notes", r.credit_notes.count, -r.credit_notes.taxable, -r.credit_notes.cgst, -r.credit_notes.sgst, -r.credit_notes.igst, -r.credit_notes.total],
  ], [2, 3, 4, 5, 6]);
  sheet("Sources", ["Source", "Bookings", "Value"],
    r.by_source.map((s) => [labelize(s.source), s.bookings, s.value]), [2]);
  sheet("Cancellations", ["Status", "Bookings", "Value lost"],
    r.cancellations.map((c) => [labelize(c.status), c.bookings, c.value]), [2]);
  sheet("Daily", ["Date", "Rooms sold"], r.daily.map((d) => [d.date, d.sold]));

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="hotel-report-${from}-to-${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
