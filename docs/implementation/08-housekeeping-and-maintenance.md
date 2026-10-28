# Phase 08 — Housekeeping & Maintenance

**Goal:** close the room lifecycle loop: checkout → dirty → cleaning → (inspection) → available, plus repair tracking that can take a room out of service.

**Depends on:** Phase 04 (checkout), Phase 02 (rooms).

## Scope

- Automatic housekeeping task when a guest checks out
- Task statuses, staff assignment, priority, notes, completion tracking
- Room status follows the task: dirty → cleaning → inspection (optional) → available
- Maintenance requests: priority, assignee, status open → in progress → completed, cost
- Room unavailable while under maintenance; released back to available on completion

## Prerequisite

Run `supabase/migrations/007_housekeeping_maintenance.sql` in the SQL Editor **after 006** (the maintenance cost-to-expense option uses `record_expense` from 006).

## Decisions made in this phase

- **Housekeeping steps are enforced** (`advance_hk_task`): To clean → Cleaning → (Inspection, optional) → Done; inspection can send it back to Cleaning; any open task can be cancelled. Old code allowed any jump and overwrote notes and assignee on every update.
- **Room status follows the task only when the room is in the cleaning cycle** (Dirty / Cleaning / Inspection). An occupied, under-repair or blocked room is never made Available by a task.
- **Manual tasks** (`create_hk_task`) for stay-over or deep cleans: a free room becomes Dirty until done; an occupied room keeps its status; one open task per room.
- **Board view** with columns, priority ordering, assign/priority per card, "Assigned to me" filter, done-today column.
- **Maintenance** (`report_maintenance`, `advance_maintenance`): Open → In progress → Completed (or Cancelled). "Out of service" sets the room to Maintenance; refused while a guest is in the room. The room returns to Available only when the last blocking job for it is closed.
- **Cost:** tracked on the job; optionally recorded once as a "Maintenance" expense when completing (linked from the job, so it is never entered twice).
- Upcoming bookings in an out-of-service room are listed on the job so staff can move them.

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~781–818: `housekeeping_tasks`, `maintenance_requests` (+ related triggers/room-status sync where present) |
| Pages | `src/app/(app)/housekeeping/page.tsx`, `housekeeping/actions.ts` (`updateHousekeepingTask`, `createMaintenance`, `updateMaintenance`), `src/app/(app)/maintenance/page.tsx` |

## How to test (spec: "Checkout to Housekeeping")

1. Check out a guest (Phase 04) → room `dirty`, and a housekeeping task appears in `/housekeeping` **without manual entry**.
2. Assign a staff member, set priority → status Cleaning → room `cleaning`.
3. Complete (optionally via inspection) → room `available` and can be booked again; status history has each step.
4. Report maintenance on a room, mark **block room** → room `maintenance`, booking it is refused (Phase 03 rule).
5. Move issue to In Progress → record cost → Completed → release → room `available`.
6. Log in as a `housekeeping` user (needs the seed from Phase 10) → should see and update only its own tasks.

## Exit criteria

- [ ] Checkout creates the task automatically; completing it frees the room.
- [ ] Maintenance can block and release rooms; costs recorded.

## Known gaps / to verify

- Task auto-creation now happens inside the DB functions `check_out_booking` and `change_room` (migration 003), not in app code.
- Housekeeping-role restriction is a Phase 10 item; today every staff role can edit everything.
