import Link from "next/link";
import { PageHeader, Panel, EmptyState, StatusPill, btnPrimary, btnSoft } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayLocal } from "@/lib/dates";
import { loadReport } from "@/lib/report";
import { formatDate, formatMoney, labelize, rel } from "@/lib/types";

type Named = { full_name: string } | { full_name: string }[] | null;
type Room = { room_number: string } | { room_number: string }[] | null;

function Stat({ label, value, href, hint }: { label: string; value: string; href?: string; hint?: string }) {
  const body = (
    <Panel className={href ? "h-full transition hover:border-[var(--brand)]" : "h-full"}>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </Panel>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = todayLocal();
  const start = `${today}T00:00:00+05:30`;
  const end = `${addDays(today, 1)}T00:00:00+05:30`;

  const [
    { data: rooms },
    { data: arrivals },
    { data: departures },
    { count: inHouse },
    { count: checkedInToday },
    { count: checkedOutToday },
    { data: payments },
    { data: refunds },
    { data: expenses },
    { data: dues },
    { data: accounts },
    { data: created },
    { count: hkOpen },
    { count: maintOpen },
    { count: refundsPending },
    { count: expensesPending },
    { report },
  ] = await Promise.all([
    supabase.from("rooms").select("id, status").eq("is_active", true),
    supabase
      .from("bookings")
      .select("id, booking_code, status, balance_due, guests(full_name), rooms(room_number)")
      .eq("check_in_date", today)
      .in("status", ["confirmed", "hold"])
      .order("created_at"),
    supabase
      .from("bookings")
      .select("id, booking_code, balance_due, guests(full_name), rooms(room_number)")
      .eq("check_out_date", today)
      .eq("status", "checked_in")
      .order("created_at"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "checked_in"),
    supabase.from("check_ins").select("id", { count: "exact", head: true }).gte("checked_in_at", start).lt("checked_in_at", end),
    supabase.from("check_outs").select("id", { count: "exact", head: true }).gte("checked_out_at", start).lt("checked_out_at", end),
    supabase.from("payments").select("amount, method").eq("voided", false).gte("received_at", start).lt("received_at", end),
    supabase
      .from("refunds")
      .select("amount")
      .eq("approval_status", "approved")
      .gte("decided_at", start)
      .lt("decided_at", end),
    supabase.from("expenses").select("amount").eq("posted", true).eq("reversed", false).eq("expense_date", today),
    supabase
      .from("bookings")
      .select("balance_due")
      .gt("balance_due", 0)
      .in("status", ["hold", "confirmed", "checked_in", "checked_out"]),
    supabase.from("accounts").select("name, balance, kind").in("kind", ["cash", "upi", "bank", "card"]).order("name"),
    supabase
      .from("bookings")
      .select("total_amount")
      .gte("created_at", start)
      .lt("created_at", end)
      .not("status", "in", "(cancelled,no_show,enquiry)"),
    supabase.from("housekeeping_tasks").select("id", { count: "exact", head: true }).in("status", ["pending", "cleaning", "inspection"]),
    supabase.from("maintenance_requests").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("refunds").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
    loadReport(supabase, today, today),
  ]);

  const sum = <T,>(rows: T[] | null, f: (r: T) => number) => (rows || []).reduce((s, r) => s + f(r), 0);
  const totalRooms = rooms?.length ?? 0;
  const count = (s: string) => (rooms || []).filter((r) => r.status === s).length;
  const occupied = count("occupied");
  const received = sum(payments, (p) => Number(p.amount));
  const refunded = sum(refunds, (r) => Number(r.amount));
  const methods = new Map<string, number>();
  for (const p of payments || []) methods.set(p.method, (methods.get(p.method) ?? 0) + Number(p.amount));

  const approvals = (refundsPending ?? 0) + (expensesPending ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${formatDate(today)} · live numbers for today`}
        actions={
          <>
            <Link href="/bookings/new" className={btnPrimary}>
              New booking
            </Link>
            <Link href="/payments/new" className={btnSoft}>
              Record payment
            </Link>
            <Link href="/expenses/new" className={btnSoft}>
              Add expense
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Arriving today" value={String(arrivals?.length ?? 0)} href="/bookings?when=arriving" hint={`${checkedInToday ?? 0} checked in so far`} />
        <Stat label="Departing today" value={String(departures?.length ?? 0)} href="/bookings?when=departing" hint={`${checkedOutToday ?? 0} checked out so far`} />
        <Stat label="In-house guests" value={String(inHouse ?? 0)} href="/bookings?status=checked_in" />
        <Stat label="Occupancy" value={`${occupied} / ${totalRooms}`} href="/rooms" hint={`${count("available")} available · ${count("dirty") + count("cleaning") + count("inspection")} being cleaned · ${count("maintenance") + count("blocked")} out of service`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bookings made today" value={String(created?.length ?? 0)} hint={`${formatMoney(sum(created, (b) => Number(b.total_amount)))} total value`} />
        <Stat label="Room revenue today" value={report ? formatMoney(report.room_revenue) : "—"} hint={report ? `Occupancy ${report.occupancy_pct ?? 0}%` : undefined} />
        <Stat label="Payments received" value={formatMoney(received)} hint={refunded ? `${formatMoney(refunded)} refunded` : undefined} href="/payments" />
        <Stat label="Expenses today" value={formatMoney(sum(expenses, (e) => Number(e.amount)))} href="/expenses" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <h3 className="mb-3 font-semibold">Arriving today</h3>
          {!arrivals?.length ? (
            <EmptyState message="No arrivals waiting." />
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {arrivals.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                      {rel(b.guests as Named)?.full_name}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">
                      Room {rel(b.rooms as Room)?.room_number} · {b.booking_code}
                    </span>
                  </span>
                  <StatusPill tone={Number(b.balance_due) > 0 ? "warn" : "ok"}>
                    {Number(b.balance_due) > 0 ? `${formatMoney(b.balance_due)} due` : "Paid"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 font-semibold">Departing today</h3>
          {!departures?.length ? (
            <EmptyState message="No departures due." />
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {departures.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                      {rel(b.guests as Named)?.full_name}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">
                      Room {rel(b.rooms as Room)?.room_number} · {b.booking_code}
                    </span>
                  </span>
                  <StatusPill tone={Number(b.balance_due) > 0 ? "warn" : "ok"}>
                    {Number(b.balance_due) > 0 ? `${formatMoney(b.balance_due)} due` : "Settled"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 font-semibold">Needs attention</h3>
          <ul className="space-y-2 text-sm">
            {[
              ["Guest dues outstanding", formatMoney(sum(dues, (b) => Number(b.balance_due))), "/accounts"],
              ["Rooms waiting to be cleaned", String(hkOpen ?? 0), "/housekeeping"],
              ["Open maintenance jobs", String(maintOpen ?? 0), "/maintenance"],
              ["Refunds / expenses to approve", String(approvals), approvals ? "/payments" : "/expenses"],
            ].map(([label, value, href]) => (
              <li key={label}>
                <Link href={href} className="flex justify-between rounded-xl px-2 py-2 hover:bg-[var(--brand-tint)]">
                  <span>{label}</span>
                  <span className="font-semibold">{value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-3 font-semibold">Account balances</h3>
          <ul className="divide-y divide-[var(--line)] text-sm">
            {(accounts || []).map((a) => (
              <li key={a.name} className="flex justify-between py-2">
                <span>{a.name}</span>
                <span className="font-medium">{formatMoney(a.balance)}</span>
              </li>
            ))}
          </ul>
          <h4 className="mb-2 mt-4 text-xs uppercase text-[var(--muted)]">Received today by method</h4>
          {methods.size === 0 ? (
            <p className="text-sm text-[var(--muted)]">No payments yet today.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...methods.entries()].map(([m, amt]) => (
                <li key={m} className="flex justify-between">
                  <span>{labelize(m)}</span>
                  <span>{formatMoney(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 font-semibold">Quick actions</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              ["/bookings/new", "New booking"],
              ["/bookings?when=arriving", "Check in a guest"],
              ["/bookings?when=departing", "Check out a guest"],
              ["/payments/new", "Record payment"],
              ["/expenses/new", "Add expense"],
              ["/invoices/new", "Create invoice"],
              ["/guests/new", "New guest"],
              ["/reports", "Reports"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="rounded-xl border border-[var(--line)] bg-[var(--brand-tint)] px-3 py-3 text-center font-medium text-[var(--brand)] transition hover:bg-[var(--brand)] hover:text-white"
              >
                {label}
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
