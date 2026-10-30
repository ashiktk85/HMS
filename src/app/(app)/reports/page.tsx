import Link from "next/link";
import { PageHeader, Panel, EmptyState, Field, inputCls, btnPrimary, btnSoft } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { addDays, isDateString, monthRange, todayLocal } from "@/lib/dates";
import { loadReport } from "@/lib/report";
import { formatDate, formatMoney, labelize } from "@/lib/types";

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const money = (v: number | null) => (v == null ? "—" : formatMoney(v));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Panel>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </Panel>
  );
}

function Table({
  head,
  rows,
  empty,
  right = [],
}: {
  head: string[];
  rows: (string | number)[][];
  empty: string;
  right?: number[];
}) {
  if (!rows.length) return <EmptyState message={empty} />;
  return (
    <DataTable
      searchable={rows.length > 8}
      pageSize={15}
      columns={head.map((h, i) => ({ header: h, align: right.includes(i) ? ("right" as const) : ("left" as const) }))}
      rows={rows.map((r, i) => ({ key: String(i), cells: r, search: r.join(" ") }))}
    />
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = todayLocal();
  const month = monthRange(today.slice(0, 7));
  const from = isDateString(sp.from) ? sp.from : month.from;
  const to = isDateString(sp.to) ? sp.to : today;

  const supabase = await createClient();
  const { report, error } = await loadReport(supabase, from, to);

  const lastMonthEnd = addDays(month.from, -1);
  const lastMonth = monthRange(lastMonthEnd.slice(0, 7));
  const presets = [
    ["Today", today, today],
    ["Last 7 days", addDays(today, -6), today],
    ["This month", month.from, today],
    ["Last month", lastMonth.from, lastMonthEnd],
  ];

  const r = report;
  const gstTotals = r
    ? r.gst_invoices.reduce(
        (a, g) => ({
          taxable: a.taxable + g.taxable,
          cgst: a.cgst + g.cgst,
          sgst: a.sgst + g.sgst,
          igst: a.igst + g.igst,
          total: a.total + g.total,
        }),
        { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
      )
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Bookings, occupancy, revenue, payments, expenses, GST and Profit & Loss for any date range."
        actions={
          r ? (
            <a href={`/reports/export?from=${from}&to=${to}`} className={btnPrimary}>
              Download Excel
            </a>
          ) : null
        }
      />

      <Panel>
        <form className="flex flex-wrap items-end gap-3">
          <Field label="From">
            <input type="date" name="from" defaultValue={from} max={today} className={inputCls} />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={to} className={inputCls} />
          </Field>
          <button type="submit" className={btnPrimary}>
            Show report
          </button>
          <span className="ml-auto flex flex-wrap gap-2">
            {presets.map(([label, f, t]) => (
              <Link key={label} href={`/reports?from=${f}&to=${t}`} className={btnSoft}>
                {label}
              </Link>
            ))}
          </span>
        </form>
      </Panel>

      {error || !r ? (
        <Panel>
          <p role="alert" className="text-sm text-rose-700">
            {error ?? "Could not load the report."}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            If this says the function does not exist, run migration 008_reports.sql in the Supabase SQL Editor.
          </p>
        </Panel>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            {formatDate(r.from)} to {formatDate(r.to)} · {r.days} day{r.days === 1 ? "" : "s"} · {r.rooms} active room
            {r.rooms === 1 ? "" : "s"}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Occupancy" value={pct(r.occupancy_pct)} hint={`${r.room_nights_sold} of ${r.room_nights_available} room nights`} />
            <Stat label="ADR" value={money(r.adr)} hint="Room revenue ÷ room nights sold" />
            <Stat label="RevPAR" value={money(r.revpar)} hint="Room revenue ÷ room nights available" />
            <Stat label="Room revenue" value={formatMoney(r.room_revenue)} hint="Rate × nights, less discount; excludes GST and extras" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Income (invoiced, before GST)" value={formatMoney(r.income)} />
            <Stat label="Expenses" value={formatMoney(r.expenses_total)} />
            <Stat label={r.income - r.expenses_total >= 0 ? "Profit" : "Loss"} value={formatMoney(r.income - r.expenses_total)} />
            <Stat label="Outstanding from guests" value={formatMoney(r.outstanding.total)} hint={`${r.outstanding.count} booking(s), as of now`} />
          </div>

          <Panel>
            <h3 className="mb-3 font-semibold">Rooms sold per day</h3>
            {r.rooms > 0 ? (
              <div className="flex h-28 items-end gap-0.5 overflow-x-auto" role="img" aria-label="Rooms sold per day">
                {r.daily.map((d) => (
                  <div key={d.date} className="flex min-w-2 flex-1 flex-col items-center justify-end" title={`${formatDate(d.date)}: ${d.sold} of ${r.rooms}`}>
                    <div className="w-full rounded-t bg-[var(--brand)]" style={{ height: `${Math.max((d.sold / r.rooms) * 100, d.sold ? 4 : 0)}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No active rooms." />
            )}
            <p className="mt-2 text-xs text-[var(--muted)]">Each bar is a day; full height means every room was sold.</p>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="mb-3 font-semibold">Room type performance</h3>
              <Table
                head={["Type", "Rooms", "Nights", "Occ.", "ADR", "RevPAR", "Revenue"]}
                right={[1, 2, 3, 4, 5, 6]}
                empty="No rooms."
                rows={r.by_type.map((t) => [t.type, t.rooms, t.nights, pct(t.occupancy_pct), money(t.adr), money(t.revpar), formatMoney(t.revenue)])}
              />
            </Panel>
            <Panel>
              <h3 className="mb-3 font-semibold">Room-wise performance</h3>
              <Table
                head={["Room", "Type", "Nights", "Occ.", "Revenue"]}
                right={[2, 3, 4]}
                empty="No rooms."
                rows={r.by_room.map((x) => [x.room_number, x.type, x.nights, pct(x.occupancy_pct), formatMoney(x.revenue)])}
              />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="mb-3 font-semibold">Payments by method</h3>
              <Table
                head={["Method", "Received", "Refunded", "Net"]}
                right={[1, 2, 3]}
                empty="No payments in this range."
                rows={[
                  ...r.payments_by_method.map((p) => [p.method, formatMoney(p.received), formatMoney(p.refunded), formatMoney(p.received - p.refunded)]),
                  ...(r.payments_by_method.length
                    ? [["Total", formatMoney(r.received_total), formatMoney(r.refunded_total), formatMoney(r.received_total - r.refunded_total)]]
                    : []),
                ]}
              />
            </Panel>
            <Panel>
              <h3 className="mb-3 font-semibold">Expenses by category</h3>
              <Table
                head={["Category", "Entries", "Amount"]}
                right={[1, 2]}
                empty="No expenses in this range."
                rows={[
                  ...r.expenses_by_category.map((e) => [e.category, e.count, formatMoney(e.amount)]),
                  ...(r.expenses_by_category.length ? [["Total", "", formatMoney(r.expenses_total)]] : []),
                ]}
              />
            </Panel>
          </div>

          <Panel>
            <h3 className="mb-3 font-semibold">GST summary</h3>
            <Table
              head={["Invoices", "Count", "Taxable value", "CGST", "SGST", "IGST", "Total"]}
              right={[1, 2, 3, 4, 5, 6]}
              empty="No invoices issued in this range."
              rows={[
                ...r.gst_invoices.map((g) => [labelize(g.type), g.count, formatMoney(g.taxable), formatMoney(g.cgst), formatMoney(g.sgst), formatMoney(g.igst), formatMoney(g.total)]),
                ...(r.credit_notes.count
                  ? [["Less: credit notes", r.credit_notes.count, formatMoney(-r.credit_notes.taxable), formatMoney(-r.credit_notes.cgst), formatMoney(-r.credit_notes.sgst), formatMoney(-r.credit_notes.igst), formatMoney(-r.credit_notes.total)]]
                  : []),
                ...(gstTotals && (r.gst_invoices.length || r.credit_notes.count)
                  ? [[
                      "Net (after credit notes)",
                      "",
                      formatMoney(gstTotals.taxable - r.credit_notes.taxable),
                      formatMoney(gstTotals.cgst - r.credit_notes.cgst),
                      formatMoney(gstTotals.sgst - r.credit_notes.sgst),
                      formatMoney(gstTotals.igst - r.credit_notes.igst),
                      formatMoney(gstTotals.total - r.credit_notes.total),
                    ]]
                  : []),
              ]}
            />
            <p className="mt-2 text-xs text-[var(--muted)]">
              Non-GST invoices carry no tax, so their tax columns are zero. Voided invoices ({r.voided_invoices}) are
              excluded.
            </p>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="mb-3 font-semibold">Bookings by source (by arrival date)</h3>
              <Table
                head={["Source", "Bookings", "Value"]}
                right={[1, 2]}
                empty="No bookings arriving in this range."
                rows={r.by_source.map((s) => [labelize(s.source), s.bookings, formatMoney(s.value)])}
              />
            </Panel>
            <Panel>
              <h3 className="mb-3 font-semibold">Cancellations and refunds</h3>
              <Table
                head={["", "Bookings", "Value lost"]}
                right={[1, 2]}
                empty="No cancellations or no-shows arriving in this range."
                rows={r.cancellations.map((c) => [labelize(c.status), c.bookings, formatMoney(c.value)])}
              />
              <p className="mt-3 text-sm">
                Refunds paid in this range: <span className="font-semibold">{formatMoney(r.refunded_total)}</span>
              </p>
            </Panel>
          </div>

          <p className="text-xs text-[var(--muted)]">
            Rooms sold counts confirmed, checked-in and checked-out stays. Available room nights use today&apos;s count of
            active rooms for the whole range.
          </p>
        </>
      )}
    </div>
  );
}
