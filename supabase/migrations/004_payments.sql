-- Phase 05: payments, refunds and accounts
-- Run in the Supabase SQL Editor after 001, 002 and 003.
--
-- 1. Configurable payment methods, each mapped to the account its money goes to
--    (fixes "Credit Card" silently landing in the Cash account).
-- 2. Payments get a receipt number and can be voided with a reason (never deleted).
-- 3. Recording a payment, requesting/deciding a refund and voiding a payment run as
--    single transactions with the checks inside the database.

-- ========== payment methods ==========
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_id uuid not null references public.accounts(id),
  requires_reference boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.payment_methods (name, account_id, requires_reference, sort_order)
select m.name, a.id, m.requires_reference, m.sort_order
from (values
  ('Cash',          'cash', false, 1),
  ('UPI',           'upi',  true,  2),
  ('Bank Transfer', 'bank', true,  3),
  ('Credit Card',   'card', true,  4),
  ('Debit Card',    'card', true,  5)
) as m(name, kind, requires_reference, sort_order)
join public.accounts a on a.kind = m.kind::public.account_kind
on conflict (name) do nothing;

alter table public.payment_methods enable row level security;
drop policy if exists "staff_read_payment_methods" on public.payment_methods;
drop policy if exists "manager_write_payment_methods" on public.payment_methods;
drop policy if exists "manager_update_payment_methods" on public.payment_methods;
create policy "staff_read_payment_methods" on public.payment_methods
  for select to authenticated using (public.is_staff());
create policy "manager_write_payment_methods" on public.payment_methods
  for insert to authenticated
  with check (public.has_role(array['owner','manager']::public.app_role[]));
create policy "manager_update_payment_methods" on public.payment_methods
  for update to authenticated
  using (public.has_role(array['owner','manager']::public.app_role[]));

-- ========== payments ==========
create sequence if not exists public.payment_receipt_seq;

alter table public.payments
  add column if not exists account_id uuid references public.accounts(id),
  add column if not exists receipt_no text unique
    default ('RC-' || lpad(nextval('public.payment_receipt_seq')::text, 6, '0')),
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id);

-- Backfill account for existing payments using the old name/kind matching.
update public.payments p
set account_id = coalesce(
  (select a.id from public.accounts a
   where lower(a.name) = lower(p.method) or a.kind::text = lower(p.method) limit 1),
  (select id from public.accounts where kind = 'cash' limit 1))
where p.account_id is null;

alter table public.payments alter column account_id set not null;

-- ========== refunds ==========
alter table public.refunds
  add column if not exists account_id uuid references public.accounts(id),
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;

update public.refunds r
set account_id = coalesce(
  (select a.id from public.accounts a
   where lower(a.name) = lower(r.method) or a.kind::text = lower(r.method) limit 1),
  (select id from public.accounts where kind = 'cash' limit 1))
where r.account_id is null;

alter table public.refunds alter column account_id set not null;

-- ========== ledger triggers ==========
create or replace function public.after_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, booking_id, created_by
  ) values (
    new.account_id, 'credit', new.amount,
    'Payment ' || coalesce(new.receipt_no, '') || ' (' || new.method || ')',
    'payment', new.id, new.booking_id, new.received_by
  );

  -- The bookings before-update trigger recomputes balance_due from amount_paid.
  update public.bookings
  set amount_paid = amount_paid + new.amount, updated_at = now()
  where id = new.booking_id;
  return new;
end;
$$;

create or replace function public.after_payment_void()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, booking_id, created_by
  ) values (
    new.account_id, 'debit', new.amount,
    'Payment ' || coalesce(new.receipt_no, '') || ' voided: ' || coalesce(new.void_reason, ''),
    'payment_void', new.id, new.booking_id, new.voided_by
  );

  update public.bookings
  set amount_paid = greatest(amount_paid - new.amount, 0), updated_at = now()
  where id = new.booking_id;
  return new;
end;
$$;

drop trigger if exists payments_after_void on public.payments;
create trigger payments_after_void
  after update of voided on public.payments
  for each row when (old.voided = false and new.voided = true)
  execute function public.after_payment_void();

create or replace function public.after_refund_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_status is distinct from 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.approval_status = 'approved' then
    return new;
  end if;

  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, booking_id, created_by
  ) values (
    new.account_id, 'debit', new.amount,
    'Refund (' || new.method || '): ' || coalesce(new.reason, ''),
    'refund', new.id, new.booking_id, coalesce(new.approved_by, new.created_by)
  );

  update public.bookings
  set amount_paid = greatest(amount_paid - new.amount, 0), updated_at = now()
  where id = new.booking_id;
  return new;
end;
$$;

-- ========== record a payment ==========
create or replace function public.record_payment(
  p_booking_id uuid,
  p_amount numeric,
  p_method_id uuid,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
as $$
declare
  b public.bookings%rowtype;
  m public.payment_methods%rowtype;
  amt numeric(12,2);
  pid uuid;
begin
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'Enter an amount above zero'; end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('enquiry', 'hold', 'confirmed', 'checked_in', 'checked_out') then
    raise exception 'Payments cannot be recorded on a % booking', b.status;
  end if;
  if amt > b.balance_due then
    raise exception 'Amount % is more than the balance due (%)', amt, b.balance_due;
  end if;

  select * into m from public.payment_methods where id = p_method_id and is_active;
  if not found then raise exception 'Choose a payment method'; end if;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception '% payments need a transaction reference', m.name;
  end if;

  insert into public.payments (booking_id, amount, method, account_id, reference, notes, received_by)
  values (b.id, amt, m.name, m.account_id, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid())
  returning id into pid;

  -- Workflow: receiving an advance confirms the booking.
  if b.status in ('enquiry', 'hold') then
    update public.bookings set status = 'confirmed' where id = b.id;
  end if;

  perform public.write_audit('create', 'payments', pid, jsonb_build_object(
    'booking_id', b.id, 'amount', amt, 'method', m.name, 'reference', p_reference));
  return pid;
end;
$$;

-- ========== refunds ==========
create or replace function public.request_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_method_id uuid,
  p_reason text
)
returns uuid
language plpgsql
as $$
declare
  p public.payments%rowtype;
  m public.payment_methods%rowtype;
  amt numeric(12,2);
  refundable numeric(12,2);
  needs_approval boolean;
  rid uuid;
begin
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'Enter a refund amount above zero'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for a refund'; end if;

  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.voided then raise exception 'This payment has been voided'; end if;

  refundable := p.amount - coalesce((
    select sum(amount) from public.refunds
    where payment_id = p.id and approval_status in ('pending', 'approved')), 0);
  if amt > refundable then
    raise exception 'Only % can still be refunded on this payment', refundable;
  end if;

  select * into m from public.payment_methods where id = p_method_id and is_active;
  if not found then raise exception 'Choose how the refund is paid out'; end if;

  select coalesce(
    (select require_refund_approval from public.hotel_settings limit 1), true)
  into needs_approval;

  insert into public.refunds (
    payment_id, booking_id, amount, reason, method, account_id,
    approval_status, approved_by, decided_at, created_by
  ) values (
    p.id, p.booking_id, amt, trim(p_reason), m.name, m.account_id,
    case when needs_approval then 'pending' else 'approved' end::public.expense_approval,
    case when needs_approval then null else auth.uid() end,
    case when needs_approval then null else now() end,
    auth.uid()
  ) returning id into rid;

  perform public.write_audit('create', 'refunds', rid, jsonb_build_object(
    'payment_id', p.id, 'amount', amt, 'needs_approval', needs_approval, 'reason', p_reason));
  return rid;
end;
$$;

create or replace function public.decide_refund(
  p_refund_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
as $$
declare
  r public.refunds%rowtype;
begin
  if not public.has_role(array['owner', 'manager']::public.app_role[]) then
    raise exception 'Only the owner or a manager can approve or reject refunds';
  end if;
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund not found'; end if;
  if r.approval_status <> 'pending' then
    raise exception 'This refund was already %', r.approval_status;
  end if;

  update public.refunds
  set approval_status = case when p_approve then 'approved' else 'rejected' end::public.expense_approval,
      approved_by = auth.uid(),
      decided_at = now(),
      decision_note = nullif(trim(p_note), '')
  where id = r.id;

  perform public.write_audit(case when p_approve then 'approve' else 'reject' end,
    'refunds', r.id, jsonb_build_object('amount', r.amount, 'note', p_note));
end;
$$;

-- ========== void a payment (mistakes only; refunds are the normal way to return money) ==========
create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason text
)
returns void
language plpgsql
as $$
declare
  p public.payments%rowtype;
begin
  if not public.has_role(array['owner', 'manager']::public.app_role[]) then
    raise exception 'Only the owner or a manager can void a payment';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void a payment'; end if;

  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.voided then raise exception 'This payment is already voided'; end if;
  if exists (
    select 1 from public.refunds
    where payment_id = p.id and approval_status in ('pending', 'approved')
  ) then
    raise exception 'This payment has refunds. Reject pending ones; approved refunds cannot be undone.';
  end if;

  update public.payments
  set voided = true, void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid()
  where id = p.id;

  perform public.write_audit('void', 'payments', p.id, jsonb_build_object(
    'booking_id', p.booking_id, 'amount', p.amount, 'receipt_no', p.receipt_no, 'reason', trim(p_reason)));
end;
$$;

revoke execute on function
  public.record_payment(uuid, numeric, uuid, text, text),
  public.request_refund(uuid, numeric, uuid, text),
  public.decide_refund(uuid, boolean, text),
  public.void_payment(uuid, text)
from public, anon;
grant execute on function
  public.record_payment(uuid, numeric, uuid, text, text),
  public.request_refund(uuid, numeric, uuid, text),
  public.decide_refund(uuid, boolean, text),
  public.void_payment(uuid, text)
to authenticated;

notify pgrst, 'reload schema';
