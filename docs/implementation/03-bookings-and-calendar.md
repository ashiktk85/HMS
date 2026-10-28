# Phase 03 — Bookings & Calendar

**Goal:** create and manage bookings with availability checking and hard double-booking prevention. No money movement yet beyond the booking total.

**Depends on:** Phase 02.

## Scope

- Sources: direct, walk-in, phone, WhatsApp
- Statuses: enquiry, hold, confirmed, checked_in, checked_out, cancelled, no_show
- Guest select/create, room + dates, rate, discount, extra bed, extra charges → computed total
- Availability search; booking calendar
- Double-booking prevention in the **database** (not just UI)
- Blocked/maintenance rooms cannot be booked
- Status history, generated booking code

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~281–386 (`bookings`, `booking_status_history`, `log_booking_status_change`, `prevent_double_booking` + `bookings_no_overlap` trigger); ~848–903 (`generate_booking_code`, `bookings_recalc_on_update`) |
| Pages | `src/app/(app)/bookings/page.tsx`, `bookings/new/page.tsx`, `bookings/calendar/page.tsx`, `bookings/[id]/page.tsx` |
| Actions | `src/app/(app)/bookings/actions.ts`: `createBooking`, `updateBookingStatus` (check-in/out/folio actions in the same file belong to Phase 04) |

## How to test

1. `/bookings/new`: pick guest, room, dates, rate → save. Booking gets a code; total = nights × rate − discount + extras (verify the maths by hand for 2 cases).
2. Create a second booking for the same room with overlapping dates → rejected (try `hold` and `confirmed`). Back-to-back dates (checkout day = next check-in day) → allowed.
3. Set a room to `maintenance` or `blocked` (Phase 02 UI) → booking it as hold/confirmed is refused.
4. `/bookings/calendar`: bookings appear on the right rooms/dates.
5. Move a booking through enquiry → hold → confirmed → cancelled; check `booking_status_history`. A cancelled booking frees the room for those dates.
6. Try to create the overlapping booking by any route other than the form (e.g. Supabase SQL insert) → the trigger still blocks it.

## Exit criteria

- [ ] Totals are correct for discount/extra-bed cases, using decimals.
- [ ] No overlapping active booking can exist, proven at DB level.
- [ ] Calendar reflects reality; status history recorded.

## Decisions made in this phase

- **Availability comes from bookings, not from room status.** Creating a hold/confirmed booking no longer flips the room to `reserved` (a booking next month would wrongly show the room as reserved today). Room status changes at check-in (occupied) and checkout (dirty).
- **Booking creation is two steps:** pick dates, then choose from rooms free for those dates (rate fills from the room type, live total preview).
- **Status moves are restricted** (`BOOKING_TRANSITIONS` in `src/lib/types.ts`): enquiry → hold/confirmed/cancelled, hold → confirmed/cancelled/no-show, confirmed → cancelled/no-show, cancelled → enquiry/hold/confirmed (re-checked for overlap), no-show → cancelled. Check-in and check-out stay on their own actions.
- **Enquiries** need free dates but do not hold the room; hold, confirmed and checked-in do (DB trigger `bookings_no_overlap`).
- **Past check-in dates are rejected**; dates use the hotel timezone (Asia/Kolkata) via `src/lib/dates.ts`.
- Calendar is a 14-day room × date grid; empty future cells link to a pre-filled new booking.

## Verified against the database

Overlap on hold and confirmed rejected; back-to-back stays allowed; maintenance room cannot be booked; check-out ≤ check-in rejected; cancelling frees the dates; reopening a cancelled booking over a newer one is rejected; total = nights × rate + extra bed + additional − discount; status history recorded.

## Known gaps / to verify

- Spec mentions `Booking Rooms` (multi-room bookings). Current schema has a single `room_id` per booking — decide whether multi-room is needed for v1 (probably defer).
- Advance payment on the booking form depends on Phase 05; until then bookings can only reach `confirmed` by manual status change.
