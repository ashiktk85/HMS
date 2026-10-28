-- Phase 04: stay workflow (check-in, room change, folio, check-out)
-- Run in the Supabase SQL Editor after 001 and 002.
--
-- 1. Folio charges get their own total on the booking, so they no longer overwrite
--    the "additional charges" entered when the booking was created.
-- 2. Folio charges can be voided (with a reason) instead of deleted.
-- 3. Check-in, room change and check-out run as single database transactions.
--    Functions are SECURITY INVOKER, so row-level security still applies to the caller.

-- ========== helpers ==========
create or replace function public.hotel_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.booking_gross(
  rate numeric, ci date, co date,
  extra_bed numeric, additional numeric, folio numeric, discount numeric
)
returns numeric
language sql
immutable
as $$
  select greatest(rate * greatest(co - ci, 1) + extra_bed + additional + folio - discount, 0)
$$;

-- ========== schema changes ==========
alter table public.bookings
  add column if not exists folio_total numeric(12,2) not null default 0;

alter table public.folio_charges
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id);

-- Backfill: the old trigger copied the folio sum into additional_charges.
update public.bookings b
set folio_total = f.total,
    additional_charges = greatest(b.additional_charges - f.total, 0)
from (
  select booking_id, sum(amount) as total
  from public.folio_charges
  where voided = false
  group by booking_id
) f
where f.booking_id = b.id;

-- ========== totals ==========
create or replace function public.generate_booking_code()
returns trigger
language plpgsql
as $$
begin
  if new.booking_code is null or new.booking_code = '' then
    new.booking_code := 'BK' || to_char(now(), 'YYMMDD')
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;
  new.subtotal := public.booking_gross(
    new.room_rate, new.check_in_date, new.check_out_date,
    new.extra_bed_charge, new.additional_charges, new.folio_total, new.discount_amount);
  new.total_amount := new.subtotal;
  new.balance_due := greatest(new.total_amount - new.amount_paid, 0);
  return new;
end;
$$;

create or replace function public.bookings_recalc_on_update()
returns trigger
language plpgsql
as $$
begin
  new.subtotal := public.booking_gross(
    new.room_rate, new.check_in_date, new.check_out_date,
    new.extra_bed_charge, new.additional_charges, new.folio_total, new.discount_amount);
  new.total_amount := new.subtotal;
  new.balance_due := greatest(new.total_amount - new.amount_paid, 0);
  return new;
end;
$$;

drop trigger if exists bookings_before_update_totals on public.bookings;
create trigger bookings_before_update_totals
  before update of room_rate, discount_amount, extra_bed_charge, additional_charges,
    folio_total, check_in_date, check_out_date, amount_paid
  on public.bookings
  for each row execute function public.bookings_recalc_on_update();

create or replace function public.touch_booking_on_folio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
begin
  bid := coalesce(new.booking_id, old.booking_id);
  -- The before-update trigger above recomputes subtotal, total and balance.
  update public.bookings set
    folio_total = (
      select coalesce(sum(amount), 0)
      from public.folio_charges
      where booking_id = bid and voided = false),
    updated_at = now()
  where id = bid;
  return coalesce(new, old);
end;
$$;

-- Recompute existing rows with the new formula.
update public.bookings set folio_total = folio_total;

-- ========== check-in ==========
create or replace function public.check_in_booking(
  p_booking_id uuid,
  p_room_id uuid,
  p_id_verified boolean,
  p_additional_guests int default 0,
  p_notes text default null
)
returns void
language plpgsql
as $$
declare
  b public.bookings%rowtype;
  r public.rooms%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('confirmed', 'hold') then
    raise exception 'Only confirmed or hold bookings can be checked in (this one is %)', b.status;
  end if;
  if b.check_in_date > public.hotel_today() then
    raise exception 'Guest is not due until %. Early check-in is not allowed here.', b.check_in_date;
  end if;
  if b.check_out_date <= public.hotel_today() then
    raise exception 'The stay dates have passed (check-out was %).', b.check_out_date;
  end if;
  if not coalesce(p_id_verified, false) then
    raise exception 'Verify the guest''s ID before check-in';
  end if;
  if coalesce(p_additional_guests, 0) < 0 then
    raise exception 'Additional guests cannot be negative';
  end if;

  select * into r from public.rooms where id = coalesce(p_room_id, b.room_id) for update;
  if not found or not r.is_active then raise exception 'Room not found'; end if;
  if r.status not in ('available', 'reserved') then
    raise exception 'Room % is % and cannot be allocated', r.room_number, r.status;
  end if;
  if r.id <> b.room_id and exists (
    select 1 from public.bookings x
    where x.room_id = r.id and x.id <> b.id
      and x.status in ('hold', 'confirmed', 'checked_in')
      and x.check_in_date < b.check_out_date and x.check_out_date > b.check_in_date
  ) then
    raise exception 'Room % is booked for overlapping dates', r.room_number;
  end if;

  insert into public.check_ins (booking_id, room_id, id_verified, additional_guests, notes, checked_in_by)
  values (b.id, r.id, true, coalesce(p_additional_guests, 0), p_notes, auth.uid());

  update public.bookings set status = 'checked_in', room_id = r.id where id = b.id;
  update public.rooms set status = 'occupied' where id = r.id;

  perform public.write_audit('check_in', 'bookings', b.id, jsonb_build_object(
    'room_id', r.id, 'room_number', r.room_number,
    'additional_guests', coalesce(p_additional_guests, 0)));
end;
$$;

-- ========== room change during a stay ==========
create or replace function public.change_room(
  p_booking_id uuid,
  p_new_room_id uuid,
  p_reason text default null
)
returns void
language plpgsql
as $$
declare
  b public.bookings%rowtype;
  r public.rooms%rowtype;
  old_room uuid;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status <> 'checked_in' then
    raise exception 'Only in-house guests can change rooms';
  end if;
  if p_new_room_id = b.room_id then
    raise exception 'The guest is already in that room';
  end if;

  select * into r from public.rooms where id = p_new_room_id for update;
  if not found or not r.is_active then raise exception 'Room not found'; end if;
  if r.status not in ('available', 'reserved') then
    raise exception 'Room % is % and cannot be allocated', r.room_number, r.status;
  end if;
  if exists (
    select 1 from public.bookings x
    where x.room_id = r.id and x.id <> b.id
      and x.status in ('hold', 'confirmed', 'checked_in')
      and x.check_in_date < b.check_out_date and x.check_out_date > public.hotel_today()
  ) then
    raise exception 'Room % is booked before this guest checks out', r.room_number;
  end if;

  old_room := b.room_id;
  update public.bookings set room_id = r.id where id = b.id;
  update public.rooms set status = 'occupied' where id = r.id;
  update public.rooms set status = 'dirty' where id = old_room;

  insert into public.housekeeping_tasks (room_id, booking_id, status, priority, notes)
  values (old_room, b.id, 'pending', 'medium', 'Auto-created after room change');

  perform public.write_audit('room_change', 'bookings', b.id, jsonb_build_object(
    'from_room_id', old_room, 'to_room_id', r.id, 'to_room_number', r.room_number,
    'reason', p_reason));
end;
$$;

-- ========== void a folio charge ==========
create or replace function public.void_folio_charge(
  p_charge_id uuid,
  p_reason text
)
returns void
language plpgsql
as $$
declare
  c public.folio_charges%rowtype;
  s public.booking_status;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void a charge'; end if;
  select * into c from public.folio_charges where id = p_charge_id for update;
  if not found then raise exception 'Charge not found'; end if;
  if c.voided then raise exception 'Charge is already voided'; end if;
  select status into s from public.bookings where id = c.booking_id;
  if s <> 'checked_in' then
    raise exception 'Charges can only be voided while the guest is in-house';
  end if;

  update public.folio_charges
  set voided = true, void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid()
  where id = c.id;

  perform public.write_audit('void', 'folio_charges', c.id, jsonb_build_object(
    'booking_id', c.booking_id, 'description', c.description,
    'amount', c.amount, 'reason', trim(p_reason)));
end;
$$;

-- ========== check-out ==========
create or replace function public.check_out_booking(
  p_booking_id uuid,
  p_allow_outstanding boolean default false,
  p_notes text default null
)
returns jsonb
language plpgsql
as $$
declare
  b public.bookings%rowtype;
  hk_priority public.priority_level := 'medium';
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status <> 'checked_in' then
    raise exception 'Only checked-in bookings can be checked out (this one is %)', b.status;
  end if;
  if b.balance_due > 0 and not coalesce(p_allow_outstanding, false) then
    raise exception 'A balance of % is still due. Collect payment, or confirm check-out with the amount outstanding.', b.balance_due;
  end if;

  insert into public.check_outs (booking_id, final_bill, outstanding, notes, checked_out_by)
  values (b.id, b.total_amount, b.balance_due,
          coalesce(p_notes, case when b.balance_due > 0 then 'Checked out with balance outstanding' end),
          auth.uid());

  update public.bookings set status = 'checked_out' where id = b.id;
  update public.rooms set status = 'dirty' where id = b.room_id;

  -- Rush the clean if someone is due into this room today.
  if exists (
    select 1 from public.bookings x
    where x.room_id = b.room_id and x.id <> b.id
      and x.status in ('hold', 'confirmed')
      and x.check_in_date <= public.hotel_today()
  ) then
    hk_priority := 'high';
  end if;

  insert into public.housekeeping_tasks (room_id, booking_id, status, priority, notes)
  values (b.room_id, b.id, 'pending', hk_priority, 'Auto-created after checkout');

  perform public.write_audit('check_out', 'bookings', b.id, jsonb_build_object(
    'final_bill', b.total_amount, 'outstanding', b.balance_due));

  return jsonb_build_object('final_bill', b.total_amount, 'outstanding', b.balance_due);
end;
$$;

-- Only signed-in staff may call these.
revoke execute on function
  public.check_in_booking(uuid, uuid, boolean, int, text),
  public.change_room(uuid, uuid, text),
  public.void_folio_charge(uuid, text),
  public.check_out_booking(uuid, boolean, text)
from public, anon;
grant execute on function
  public.check_in_booking(uuid, uuid, boolean, int, text),
  public.change_room(uuid, uuid, text),
  public.void_folio_charge(uuid, text),
  public.check_out_booking(uuid, boolean, text)
to authenticated;

notify pgrst, 'reload schema';
