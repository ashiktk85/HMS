import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  StatusPill,
  Field,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/dates";
import { BLOCKING_BOOKING_STATUSES, formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { advanceMaintenance, reportMaintenance } from "../housekeeping/actions";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const priorityTone = (p: string) =>
  p === "urgent" ? ("danger" as const) : p === "high" ? ("warn" as const) : ("neutral" as const);
const statusTone = (s: string) =>
  s === "completed" ? ("ok" as const) : s === "in_progress" ? ("info" as const) : s === "cancelled" ? ("neutral" as const) : ("warn" as const);

type Person = { full_name: string } | { full_name: string }[] | null;

export default async function MaintenancePage() {
  const supabase = await createClient();
  const today = todayLocal();

  const [{ data: open }, { data: closed }, { data: rooms }, { data: staff }, { data: methods }] = await Promise.all([
    supabase
      .from("maintenance_requests")
      .select("*, rooms(id, room_number, status), assignee:profiles!maintenance_requests_assigned_to_fkey(full_name)")
      .in("status", ["open", "in_progress"])
      .order("created_at"),
    supabase
      .from("maintenance_requests")
      .select("*, rooms(room_number)")
      .in("status", ["completed", "cancelled"])
      .order("completed_at", { ascending: false })
      .limit(30),
    supabase.from("rooms").select("id, room_number, status").eq("is_active", true).order("room_number"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("payment_methods").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  // Upcoming stays in rooms that are out of service need to be moved to another room.
  const blockedRoomIds = [
    ...new Set((open || []).filter((m) => m.block_room && m.room_id).map((m) => m.room_id as string)),
  ];
  const { data: affected } = blockedRoomIds.length
    ? await supabase
        .from("bookings")
        .select("id, booking_code, room_id, check_in_date")
        .in("room_id", blockedRoomIds)
        .in("status", BLOCKING_BOOKING_STATUSES)
        .gt("check_out_date", today)
        .order("check_in_date")
    : { data: [] as { id: string; booking_code: string; room_id: string; check_in_date: string }[] };

  const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
  const openSorted = [...(open || [])].sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  const monthCost = (closed || [])
    .filter((m) => m.status === "completed" && (m.completed_at ?? "").slice(0, 7) === today.slice(0, 7))
    .reduce((s, m) => s + Number(m.cost), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description="Report an issue, assign it, track cost. Taking a room out of service stops it being booked or checked into until the job is closed."
        actions={
          <Link href="/housekeeping" className={btnSoft}>
            Housekeeping
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Open jobs</p>
          <p className="mt-1 text-2xl font-semibold">{open?.length ?? 0}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Rooms out of service</p>
          <p className="mt-1 text-2xl font-semibold">{blockedRoomIds.length}</p>
        </Panel>
        <Panel>
          <p className="text-xs uppercase text-[var(--muted)]">Cost of jobs closed this month</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(monthCost)}</p>
        </Panel>
      </div>

      <Panel>
        <h3 className="mb-3 font-semibold">Report an issue</h3>
        <ActionForm action={reportMaintenance} resetOnSuccess successMessage="Issue reported" className="grid gap-3 md:grid-cols-3">
          <Field label="Issue" className="md:col-span-2">
            <input name="title" required placeholder="AC not cooling" className={inputCls} />
          </Field>
          <Field label="Room (optional)" hint="Leave empty for common areas">
            <select name="room_id" defaultValue="" className={inputCls}>
              <option value="">No specific room</option>
              {(rooms || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number} ({labelize(r.status)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Details (optional)" className="md:col-span-3">
            <input name="description" className={inputCls} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue="medium" className={inputCls}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{labelize(p)}</option>
              ))}
            </select>
          </Field>
          <Field label="Assign to (optional)">
            <select name="assigned_to" defaultValue="" className={inputCls}>
              <option value="">Unassigned</option>
              {(staff || []).map((s) => (
                <option key={s.id} value={s.id}>{s.full_name || "Staff"}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="block_room" />
            Take the room out of service
          </label>
          <SubmitButton className={`${btnPrimary} md:col-span-3`}>Report issue</SubmitButton>
        </ActionForm>
      </Panel>

      <div className="space-y-3">
        <h3 className="font-semibold">Open jobs</h3>
        {!openSorted.length ? <EmptyState message="No open maintenance jobs." /> : null}
        {openSorted.map((m) => {
          const room = rel(m.rooms as { id: string; room_number: string; status: string } | null);
          const assignee = rel(m.assignee as Person)?.full_name;
          const clashes = (affected || []).filter((b) => m.block_room && b.room_id === m.room_id);
          return (
            <Panel key={m.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{m.title}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {room ? `Room ${room.room_number} (${labelize(room.status)})` : "Common area"} · reported{" "}
                    {formatDate(m.created_at)}
                    {assignee ? ` · ${assignee}` : " · unassigned"}
                  </p>
                  {m.description ? <p className="mt-1 text-sm">{m.description}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusPill tone={statusTone(m.status)}>{labelize(m.status)}</StatusPill>
                  <StatusPill tone={priorityTone(m.priority)}>{labelize(m.priority)}</StatusPill>
                  {m.block_room ? <StatusPill tone="danger">Out of service</StatusPill> : null}
                </div>
              </div>

              {clashes.length ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Booked stays in this room:{" "}
                  {clashes.map((b, i) => (
                    <span key={b.id}>
                      {i ? ", " : ""}
                      <Link href={`/bookings/${b.id}`} className="font-medium underline">
                        {b.booking_code}
                      </Link>{" "}
                      ({formatDate(b.check_in_date)})
                    </span>
                  ))}
                  . Move them to another room or finish the job before they arrive.
                </p>
              ) : null}

              <ActionForm action={advanceMaintenance} className="grid gap-3 md:grid-cols-4" successMessage="Updated">
                <input type="hidden" name="request_id" value={m.id} />
                <Field label="Assigned to">
                  <select name="assigned_to" defaultValue={m.assigned_to ?? ""} className={inputCls}>
                    <option value="">Unassigned</option>
                    {(staff || []).map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name || "Staff"}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Cost so far (₹)">
                  <input name="cost" type="number" min="0" step="0.01" defaultValue={Number(m.cost) || ""} className={inputCls} />
                </Field>
                <Field label="Note (optional)" className="md:col-span-2">
                  <input name="note" placeholder="Compressor replaced" className={inputCls} />
                </Field>
                <div className="flex flex-wrap items-center gap-2 text-sm md:col-span-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="record_expense" />
                    On completion, record the cost as a Maintenance expense paid by
                  </label>
                  <select name="expense_method_id" defaultValue={methods?.[0]?.id} aria-label="Paid by" className={`${inputCls} !w-40 !py-1`}>
                    {(methods || []).map((pm) => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-4">
                  <SubmitButton name="status" value={m.status} className={btnSoft}>
                    Save
                  </SubmitButton>
                  {m.status === "open" ? (
                    <SubmitButton name="status" value="in_progress" className={btnSoft}>
                      Start work
                    </SubmitButton>
                  ) : null}
                  <SubmitButton name="status" value="completed" className={btnPrimary}>
                    Complete{m.block_room ? " and return room" : ""}
                  </SubmitButton>
                  <SubmitButton
                    name="status"
                    value="cancelled"
                    className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-medium hover:bg-rose-50"
                  >
                    Cancel job
                  </SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          );
        })}
      </div>

      <Panel>
        <h3 className="mb-3 font-semibold">Recently closed</h3>
        {!closed?.length ? (
          <EmptyState message="Nothing closed yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Issue</th>
                  <th className="font-medium">Room</th>
                  <th className="font-medium">Closed</th>
                  <th className="font-medium">Status</th>
                  <th className="text-right font-medium">Cost</th>
                  <th className="font-medium">Expense</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((m) => (
                  <tr key={m.id} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      {m.title}
                      {m.resolution_note ? (
                        <span className="block text-xs text-[var(--muted)]">{m.resolution_note}</span>
                      ) : null}
                    </td>
                    <td>{rel(m.rooms as { room_number: string } | null)?.room_number ?? "—"}</td>
                    <td className="whitespace-nowrap">{formatDate(m.completed_at)}</td>
                    <td>
                      <StatusPill tone={statusTone(m.status)}>{labelize(m.status)}</StatusPill>
                    </td>
                    <td className="text-right">{formatMoney(m.cost)}</td>
                    <td>
                      {m.expense_id ? (
                        <Link href={`/expenses/${m.expense_id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">
                          View expense
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">Not recorded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
