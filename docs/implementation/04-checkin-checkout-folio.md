# Phase 04 — Check-in / Check-out & Folio

**Goal:** run a complete stay: check in, add charges during the stay, and check out with a correct final bill and outstanding-balance warning.

**Depends on:** Phase 03.

## Scope

- Check-in: guest + ID verification, room allocation, extra guests/beds → room `occupied`, booking `checked_in`
- Room change during stay
- Folio charges from `service_items` (minibar, laundry, etc.) → booking total updates automatically
- Check-out: final bill calculation, warning when balance > 0, room → `dirty`, booking `checked_out`
- Records in `check_ins` / `check_outs`

## Prerequisite

Run `supabase/migrations/003_stay_workflow.sql` in the SQL Editor (after 001 and 002). It adds `bookings.folio_total`, void columns on `folio_charges`, and the transactional functions `check_in_booking`, `change_room`, `void_folio_charge`, `check_out_booking`.

## Decisions made in this phase

- **Bug fixed:** the old folio trigger overwrote `bookings.additional_charges`, wiping upfront charges entered at booking time. Folio charges now live in `folio_total`; total = room + extra bed + additional + folio − discount.
- **Check-in** is one DB transaction. Rules: confirmed/hold only, not before the arrival date, not after the stay ended, ID must be ticked, room must be clean (available) and free for the dates. Choosing a different room at check-in is allowed.
- **Room change** during a stay: old room → Dirty + housekeeping task, new room → Occupied; rate unchanged.
- **Folio charges:** only while checked in; picking a service fills its price; charges are voided with a reason, never deleted.
- **Check-out** is one DB transaction: blocked while a balance is due unless "check out with amount outstanding" is ticked; room → Dirty; housekeeping task created (priority High if another guest is due into the room today). Early departure still bills the booked nights.
- The bookings list has Arriving today / Departing today shortcuts.

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~387–478: `check_ins`, `check_outs`, `service_items` (seeded), `folio_charges`, `touch_booking_on_folio` trigger |
| UI/actions | `src/app/(app)/bookings/[id]/page.tsx`; `bookings/actions.ts`: `checkInBooking`, `addFolioCharge`, `checkOutBooking` |

## How to test

1. Take a `confirmed` booking → check in on `/bookings/[id]` → booking `checked_in`, room `occupied`, `check_ins` row exists.
2. Add 2–3 folio charges (one custom, one from service items) → booking total and balance increase immediately; totals match hand calculation.
3. Start check-out with balance > 0 → warning shown. (Take payment in Phase 05, or for now confirm the warning appears and the outstanding due is recorded.)
4. Complete check-out → booking `checked_out`, room becomes **dirty**, `check_outs` row exists.
5. Check-in attempts that should fail: room not available, booking not confirmed, guest with no ID (verify the rule you want).

## Exit criteria

- [ ] Check-in/out change booking and room status automatically and are logged.
- [ ] Folio charges flow into the booking total without manual re-entry.
- [ ] Outstanding balance warning appears before checkout.

## Known gaps / to verify

- **Room change** during stay: spec requires it; confirm it exists in the UI, otherwise add here.
- Housekeeping task creation on checkout is completed in Phase 08 (the room-becomes-dirty half works here).
- Checkout and folio charges have no role restriction yet (Phase 10).
