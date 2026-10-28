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
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/dates";
import { labelize, rel, ROLE_LABELS, type AppRole } from "@/lib/types";
import {
  advanceHousekeepingTask,
  assignHousekeepingTask,
  createHousekeepingTask,
} from "./actions";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const priorityTone = (p: string) =>
  p === "urgent" ? ("danger" as const) : p === "high" ? ("warn" as const) : ("neutral" as const);

const NEXT_STEPS: Record<string, { status: string; label: string; primary?: boolean }[]> = {
  pending: [
    { status: "cleaning", label: "Start cleaning", primary: true },
    { status: "cancelled", label: "Cancel" },
  ],
  cleaning: [
    { status: "completed", label: "Mark clean", primary: true },
    { status: "inspection", label: "Send to inspection" },
  ],
  inspection: [
    { status: "completed", label: "Passed, room ready", primary: true },
    { status: "cleaning", label: "Back to cleaning" },
  ],
};

const COLUMNS = [
  { status: "pending", title: "To clean" },
  { status: "cleaning", title: "Cleaning" },
  { status: "inspection", title: "Inspection" },
  { status: "completed", title: "Done today" },
] as const;

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function HousekeepingPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const { mine } = await searchParams;
  const session = await getSessionProfile();
  const supabase = await createClient();
  const today = todayLocal();

  let openQuery = supabase
    .from("housekeeping_tasks")
    .select("*, rooms(room_number, status), bookings(booking_code), profiles!housekeeping_tasks_assigned_to_fkey(full_name)")
    .in("status", ["pending", "cleaning", "inspection"])
    .order("created_at");
  let doneQuery = supabase
    .from("housekeeping_tasks")
    .select("*, rooms(room_number, status), bookings(booking_code), profiles!housekeeping_tasks_assigned_to_fkey(full_name)")
    .eq("status", "completed")
    .gte("completed_at", `${today}T00:00:00+05:30`)
    .order("completed_at", { ascending: false });
  if (mine && session) {
    openQuery = openQuery.eq("assigned_to", session.user.id);
    doneQuery = doneQuery.eq("assigned_to", session.user.id);
  }

  const [{ data: open }, { data: done }, { data: staff }, { data: rooms }] = await Promise.all([
    openQuery,
    doneQuery,
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
    supabase
      .from("rooms")
      .select("id, room_number, status")
      .eq("is_active", true)
      .not("status", "in", "(maintenance,blocked)")
      .order("room_number"),
  ]);

  const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
  const tasks = [...(open || [])].sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  const byStatus = (s: string) => (s === "completed" ? done || [] : tasks.filter((t) => t.status === s));

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      active
        ? "bg-[var(--brand-soft)] text-[var(--brand)]"
        : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--brand-tint)]"
    }`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Housekeeping"
        description="To clean → Cleaning → (Inspection) → room Available. Tasks are created automatically at check-out and room change."
        actions={
          <Link href="/maintenance" className={btnSoft}>
            Maintenance
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Link href="/housekeeping" className={chip(!mine)}>All tasks</Link>
        <Link href="/housekeeping?mine=1" className={chip(!!mine)}>Assigned to me</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = byStatus(col.status);
          return (
            <div key={col.status} className="space-y-3">
              <h3 className="flex items-center justify-between text-sm font-semibold">
                {col.title}
                <span className="rounded-full bg-stone-100 px-2 text-xs text-[var(--muted)]">{list.length}</span>
              </h3>
              {!list.length ? (
                <p className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--muted)]">
                  Nothing here
                </p>
              ) : null}
              {list.map((t) => {
                const room = rel(t.rooms as { room_number: string; status: string } | null);
                const booking = rel(t.bookings as { booking_code: string } | null);
                const assignee = rel(t.profiles as { full_name: string } | null)?.full_name;
                return (
                  <Panel key={t.id} className="space-y-3 !p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold">Room {room?.room_number}</p>
                        <p className="text-xs text-[var(--muted)]">
                          Room is {labelize(room?.status ?? "")}
                          {booking ? ` · after ${booking.booking_code}` : ""}
                        </p>
                      </div>
                      <StatusPill tone={priorityTone(t.priority)}>{labelize(t.priority)}</StatusPill>
                    </div>
                    {t.notes ? <p className="whitespace-pre-line text-xs text-[var(--muted)]">{t.notes}</p> : null}

                    {col.status === "completed" ? (
                      <p className="text-xs text-[var(--muted)]">
                        Done {t.completed_at ? timeFmt.format(new Date(t.completed_at)) : ""}
                        {assignee ? ` · ${assignee}` : ""}
                      </p>
                    ) : (
                      <>
                        <ActionForm action={assignHousekeepingTask} className="flex flex-wrap items-center gap-1" successMessage="Saved">
                          <input type="hidden" name="task_id" value={t.id} />
                          <select name="assigned_to" defaultValue={t.assigned_to ?? ""} aria-label="Assigned to" className={`${inputCls} !w-auto flex-1 !py-1 text-xs`}>
                            <option value="">Unassigned</option>
                            {(staff || []).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.full_name || "Staff"} ({ROLE_LABELS[s.role as AppRole] ?? s.role})
                              </option>
                            ))}
                          </select>
                          <select name="priority" defaultValue={t.priority} aria-label="Priority" className={`${inputCls} !w-auto !py-1 text-xs`}>
                            {PRIORITIES.map((p) => (
                              <option key={p} value={p}>{labelize(p)}</option>
                            ))}
                          </select>
                          <SubmitButton className={`${btnSoft} !px-2 !py-1 text-xs`} pendingLabel="…">Save</SubmitButton>
                        </ActionForm>

                        <ActionForm action={advanceHousekeepingTask} className="space-y-2" successMessage="Updated">
                          <input type="hidden" name="task_id" value={t.id} />
                          <input name="note" placeholder="Note (optional)" aria-label="Note" className={`${inputCls} !py-1 text-xs`} />
                          <div className="flex flex-wrap gap-1">
                            {(NEXT_STEPS[t.status] ?? []).map((step) => (
                              <SubmitButton
                                key={step.status}
                                name="status"
                                value={step.status}
                                pendingLabel="…"
                                className={
                                  step.primary
                                    ? `${btnPrimary} !px-3 !py-1 text-xs`
                                    : "rounded-xl border border-[var(--line)] px-3 py-1 text-xs font-medium hover:bg-[var(--brand-tint)]"
                                }
                              >
                                {step.label}
                              </SubmitButton>
                            ))}
                          </div>
                        </ActionForm>
                      </>
                    )}
                  </Panel>
                );
              })}
            </div>
          );
        })}
      </div>

      <Panel>
        <h3 className="mb-1 font-semibold">Add a cleaning task</h3>
        <p className="mb-3 text-sm text-[var(--muted)]">
          For cleans that are not from a check-out, such as a stay-over clean or a deep clean. A free room is marked
          Dirty until the task is done; an occupied room keeps its status.
        </p>
        {!rooms?.length ? (
          <EmptyState message="No rooms available for cleaning tasks." />
        ) : (
          <ActionForm action={createHousekeepingTask} resetOnSuccess successMessage="Task added" className="grid gap-3 md:grid-cols-4">
            <Field label="Room">
              <select name="room_id" required defaultValue="" className={inputCls}>
                <option value="">Select room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_number} ({labelize(r.status)})
                  </option>
                ))}
              </select>
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
            <Field label="Notes (optional)">
              <input name="notes" placeholder="Deep clean, change curtains" className={inputCls} />
            </Field>
            <SubmitButton className={`${btnPrimary} md:col-span-4`}>Add task</SubmitButton>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
