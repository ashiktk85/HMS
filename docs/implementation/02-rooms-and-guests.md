# Phase 02 — Rooms & Guests

**Goal:** the hotel's inventory (room types, rooms, statuses) and guest directory are usable. Still no bookings.

**Depends on:** Phase 01.

## Scope

- Room types with standard rates; rooms with numbers and status
- Status set: available, reserved, occupied, dirty, cleaning, inspection, maintenance, blocked
- Room status history (automatic on change)
- Guest profiles: name, mobile, email, address, ID details, nationality, GSTIN
- Guest ID document upload (private storage bucket)
- Duplicate detection by mobile/email; guest stay history view (empty until Phase 03)

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~184–280: `room_types`, `rooms`, `room_status_history`, `log_room_status_change` trigger, `guests`, `guest_documents` |
| Storage | `002_storage_buckets.sql` (`guest-documents` bucket, private) |
| Rooms | `src/app/(app)/rooms/page.tsx`, `rooms/[id]/page.tsx`, `rooms/actions.ts` (`createRoomType`, `createRoom`, `updateRoomStatus`) |
| Guests | `src/app/(app)/guests/page.tsx`, `guests/new/page.tsx`, `guests/[id]/page.tsx`, `guests/actions.ts` (`createGuest`, `updateGuest`, `uploadGuestDocument`) |
| Types | `src/lib/types.ts` (`RoomStatus`, `ROOM_STATUSES`) |

## How to test

1. `/rooms`: create room types (e.g. Deluxe ₹3000, Standard ₹2000) and 5+ rooms.
2. Change a room's status through several values; open `/rooms/[id]` → each change is in the history with user + time.
3. `/guests/new`: create a guest with mobile + email. Try creating another with the **same mobile** → duplicate is flagged or blocked (verify which).
4. Edit the guest; upload an ID image/PDF on the guest page → file appears; confirm the storage URL is not publicly accessible (bucket is private).
5. Confirm money fields display with 2 decimals and are stored as `numeric`, not float.

## Exit criteria

- [ ] Room types/rooms CRUD works; every status change is logged with actor.
- [ ] Guests can be created, edited, searched; duplicates handled.
- [ ] ID documents upload and open only for logged-in staff.

## Known gaps / to verify

- No delete for rooms/guests via the UI (good for integrity); confirm "deactivate" exists if a room is retired.
- Any staff role can currently edit rooms and guests (Phase 10 will restrict).
