import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { createClient } from "@/lib/supabase/server";
import { advanceLabel, loadInvoiceDocument } from "@/lib/invoice-data";
import { formatDate, labelize, rel } from "@/lib/types";
import { amountInWords } from "@/lib/words";

export const dynamic = "force-dynamic";

// The built-in PDF fonts have no rupee sign, so amounts are written as "Rs.".
const num = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (v: number | string | null | undefined) => `Rs. ${num.format(Number(v ?? 0))}`;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { id } = await params;
  const data = await loadInvoiceDocument(supabase, id);
  if (!data) return new Response("Invoice not found", { status: 404 });
  const { invoice, items, taxes, credits, settings, paid, balanceDue, stays, isGst, title } = data;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const grey: [number, number, number] = [110, 110, 110];
  let y = 18;

  const text = (s: string, x: number, yy: number, opts?: { align?: "left" | "right" | "center"; size?: number; bold?: boolean; color?: [number, number, number] }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    doc.setTextColor(...(opts?.color ?? [20, 20, 20]));
    doc.text(s, x, yy, { align: opts?.align ?? "left" });
  };

  if (invoice.status === "voided") {
    doc.setDrawColor(200, 40, 40);
    doc.rect(M, y - 6, W - 2 * M, 10);
    text(`VOIDED${invoice.void_reason ? `: ${invoice.void_reason}` : ""}. This invoice is not valid.`, W / 2, y, {
      align: "center",
      bold: true,
      color: [200, 40, 40],
    });
    y += 12;
  }

  // Header: hotel on the left, invoice details on the right.
  text(settings?.hotel_name ?? "", M, y, { size: 15, bold: true });
  let ly = y + 6;
  for (const line of [
    settings?.address,
    settings?.phone ? `Phone: ${settings.phone}` : null,
    settings?.email,
    isGst && invoice.hotel_gstin ? `GSTIN: ${invoice.hotel_gstin}` : null,
  ]) {
    if (!line) continue;
    for (const part of doc.splitTextToSize(String(line), 95)) {
      text(part, M, ly, { size: 9, color: grey });
      ly += 4.5;
    }
  }
  text(title, W - M, y, { align: "right", size: 13, bold: true });
  text(invoice.invoice_number, W - M, y + 6, { align: "right", bold: true });
  text(`Date: ${formatDate(invoice.issued_at)}`, W - M, y + 11, { align: "right", size: 9 });
  text(`${stays.length > 1 ? "Bookings" : "Booking"}: ${stays.map((s) => s.booking_code).join(", ")}`, W - M, y + 16, {
    align: "right",
    size: 9,
  });
  y = Math.max(ly, y + 20) + 2;
  doc.setDrawColor(210, 210, 210);
  doc.line(M, y, W - M, y);
  y += 7;

  // Billed to / stay.
  text("BILLED TO", M, y, { size: 8, color: grey });
  text(stays.length > 1 ? "STAYS" : "STAY", W / 2 + 4, y, { size: 8, color: grey });
  let by = y + 5;
  text(invoice.billing_name ?? "", M, by, { bold: true });
  by += 5;
  if (invoice.billing_address) {
    for (const part of doc.splitTextToSize(String(invoice.billing_address), 85)) {
      text(part, M, by, { size: 9 });
      by += 4.5;
    }
  }
  if (isGst && invoice.customer_gstin) {
    text(`GSTIN: ${invoice.customer_gstin}`, M, by, { size: 9 });
    by += 4.5;
  }
  let sy = y + 5;
  for (const s of stays) {
    const room = rel(s.rooms);
    text(`${s.check_in_date} to ${s.check_out_date}${room ? `  |  Room ${room.room_number}` : ""}`, W / 2 + 4, sy, { size: 9 });
    sy += 4.5;
  }
  if (isGst) {
    text(`Supply: ${invoice.is_inter_state ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}`, W / 2 + 4, sy, { size: 9 });
    sy += 4.5;
  }
  y = Math.max(by, sy) + 4;

  // Line items.
  const head = isGst ? ["Description", "SAC", "Qty", "Rate", "GST %", "Amount"] : ["Description", "Qty", "Rate", "Amount"];
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [head],
    body: items.map((it) =>
      isGst
        ? [it.description, it.sac_code || "", String(it.quantity), rs(it.unit_amount), `${it.tax_rate}%`, rs(it.amount)]
        : [it.description, String(it.quantity), rs(it.unit_amount), rs(it.amount)],
    ),
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2, textColor: [20, 20, 20] },
    headStyles: { fontStyle: "bold", fontSize: 8, lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 }, lineColor: [150, 150, 150] },
    columnStyles: isGst
      ? { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
      : { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "head" && d.column.index >= (isGst ? 2 : 1)) d.cell.styles.halign = "right";
      if (d.section === "body") d.cell.styles.lineWidth = { bottom: 0.1, top: 0, left: 0, right: 0 };
    },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // Totals block, right-aligned.
  const totals: { label: string; value: string; bold?: boolean; color?: [number, number, number]; rule?: boolean }[] = [
    { label: isGst ? "Taxable value" : "Sub-total", value: rs(invoice.taxable_value) },
    ...taxes.map((t) => ({ label: `${t.tax_name} @ ${t.rate}%`, value: rs(t.amount) })),
    { label: "Total", value: rs(invoice.total_amount), bold: true, rule: true },
    ...paid.map((p) => ({
      label: `${advanceLabel(p)} - ${formatDate(p.received_at)} - ${p.method}`,
      value: `- ${rs(p.amount)}`,
      color: [20, 110, 70] as [number, number, number],
    })),
    ...(paid.length
      ? [{ label: balanceDue > 0 ? "Balance due" : "Balance due (fully paid)", value: rs(balanceDue), bold: true, rule: true }]
      : []),
  ];
  const left = W - M - 90;
  for (const t of totals) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    if (t.rule) {
      doc.setDrawColor(150, 150, 150);
      doc.line(left, y - 4, W - M, y - 4);
    }
    text(t.label, left, y, { size: t.bold ? 11 : 9, bold: t.bold, color: t.color });
    text(t.value, W - M, y, { align: "right", size: t.bold ? 11 : 9, bold: t.bold, color: t.color });
    y += t.bold ? 7 : 5.5;
  }
  y += 1;
  for (const part of doc.splitTextToSize(amountInWords(Number(invoice.total_amount)), W - 2 * M)) {
    text(part, M, y, { size: 8.5 });
    y += 4.2;
  }

  if (credits.length) {
    y += 4;
    text("CREDIT NOTES AGAINST THIS INVOICE", M, y, { size: 8, bold: true });
    y += 4.5;
    for (const c of credits) {
      text(`${c.credit_note_number} | ${formatDate(c.created_at)} | ${rs(c.amount)}${c.reason ? ` | ${c.reason}` : ""}`, M, y, { size: 8.5 });
      y += 4.2;
    }
  }
  if (invoice.notes) {
    y += 3;
    for (const part of doc.splitTextToSize(`Note: ${invoice.notes}`, W - 2 * M)) {
      text(part, M, y, { size: 8.5 });
      y += 4.2;
    }
  }

  text(
    `${isGst ? `${labelize(invoice.invoice_type)} invoice` : "No GST charged"} - This is a computer-generated invoice.`,
    W / 2,
    doc.internal.pageSize.getHeight() - 10,
    { align: "center", size: 8, color: grey },
  );

  const file = `${String(invoice.invoice_number).replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;
  return new Response(doc.output("arraybuffer"), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
