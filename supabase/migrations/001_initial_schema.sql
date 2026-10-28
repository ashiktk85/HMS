-- Hotel Cloud Management System — Phase 1 schema
-- Apply in Supabase SQL Editor or via CLI: supabase db push

create extension if not exists "pgcrypto";

-- ========== ENUMS ==========
create type public.app_role as enum (
  'owner', 'manager', 'receptionist', 'accountant', 'housekeeping'
);

create type public.room_status as enum (
  'available', 'reserved', 'occupied', 'dirty', 'cleaning',
  'inspection', 'maintenance', 'blocked'
);

create type public.booking_status as enum (
  'enquiry', 'hold', 'confirmed', 'checked_in', 'checked_out',
  'cancelled', 'no_show'
);

create type public.booking_source as enum (
  'direct', 'walk_in', 'phone', 'whatsapp'
);

create type public.invoice_type as enum ('gst', 'non_gst');

create type public.invoice_status as enum (
  'draft', 'issued', 'voided', 'credited'
);

create type public.hk_task_status as enum (
  'pending', 'cleaning', 'inspection', 'completed', 'cancelled'
);

create type public.maintenance_status as enum (
  'open', 'in_progress', 'completed', 'cancelled'
);

create type public.priority_level as enum ('low', 'medium', 'high', 'urgent');

create type public.expense_approval as enum (
  'pending', 'approved', 'rejected', 'not_required'
);

create type public.account_kind as enum (
  'cash', 'upi', 'bank', 'card', 'receivable', 'other'
);

-- ========== HELPERS ==========
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role')::public.app_role,
    'receptionist'::public.app_role
  );
$$;

create or replace function public.has_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = any(roles);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null;
$$;

-- ========== PROFILES ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  role public.app_role not null default 'receptionist',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'receptionist')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sync role from profiles into app_metadata when changed by owner
create or replace function public.sync_profile_role_to_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    update auth.users
    set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', new.role::text)
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_role
  after update of role on public.profiles
  for each row execute function public.sync_profile_role_to_auth();

-- ========== HOTEL SETTINGS ==========
create table public.hotel_settings (
  id uuid primary key default gen_random_uuid(),
  hotel_name text not null default 'My Hotel',
  address text,
  phone text,
  email text,
  gstin text,
  currency_code text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  cgst_rate numeric(5,2) not null default 6.00,
  sgst_rate numeric(5,2) not null default 6.00,
  igst_rate numeric(5,2) not null default 12.00,
  gst_invoice_prefix text not null default 'GST',
  non_gst_invoice_prefix text not null default 'INV',
  gst_invoice_next int not null default 1,
  non_gst_invoice_next int not null default 1,
  require_refund_approval boolean not null default true,
  require_expense_approval boolean not null default false,
  payment_methods jsonb not null default '["cash","upi","bank","card"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger hotel_settings_updated_at
  before update on public.hotel_settings
  for each row execute function public.set_updated_at();

insert into public.hotel_settings (hotel_name) values ('Hotel Cloud HMS');

-- ========== ROOM TYPES & ROOMS ==========
create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  base_rate numeric(12,2) not null default 0,
  max_occupancy int not null default 2,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger room_types_updated_at
  before update on public.room_types
  for each row execute function public.set_updated_at();

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_number text not null unique,
  room_type_id uuid not null references public.room_types(id),
  floor text,
  status public.room_status not null default 'available',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger rooms_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

create table public.room_status_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  from_status public.room_status,
  to_status public.room_status not null,
  notes text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.log_room_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.room_status_history (room_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  elsif tg_op = 'INSERT' then
    insert into public.room_status_history (room_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger rooms_status_history
  after insert or update of status on public.rooms
  for each row execute function public.log_room_status_change();

-- ========== GUESTS ==========
create table public.guests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text,
  email text,
  address text,
  nationality text default 'Indian',
  id_type text,
  id_number text,
  gstin text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guests_mobile_idx on public.guests (mobile);
create index guests_email_idx on public.guests (email);

create trigger guests_updated_at
  before update on public.guests
  for each row execute function public.set_updated_at();

create table public.guest_documents (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  mime_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ========== BOOKINGS ==========
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique,
  guest_id uuid not null references public.guests(id),
  room_id uuid not null references public.rooms(id),
  source public.booking_source not null default 'direct',
  status public.booking_status not null default 'enquiry',
  check_in_date date not null,
  check_out_date date not null,
  adults int not null default 1,
  children int not null default 0,
  room_rate numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  extra_bed_charge numeric(12,2) not null default 0,
  additional_charges numeric(12,2) not null default 0,
  nights int generated always as (greatest(check_out_date - check_in_date, 1)) stored,
  subtotal numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_dates_valid check (check_out_date > check_in_date)
);

create index bookings_room_dates_idx on public.bookings (room_id, check_in_date, check_out_date);
create index bookings_status_idx on public.bookings (status);

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create table public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  from_status public.booking_status,
  to_status public.booking_status not null,
  notes text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.log_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.booking_status_history (booking_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  elsif tg_op = 'INSERT' then
    insert into public.booking_status_history (booking_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger bookings_status_history
  after insert or update of status on public.bookings
  for each row execute function public.log_booking_status_change();

-- Prevent double booking for active statuses
create or replace function public.prevent_double_booking()
returns trigger
language plpgsql
as $$
declare
  conflict_id uuid;
  room_st public.room_status;
begin
  if new.status in ('cancelled', 'no_show', 'checked_out') then
    return new;
  end if;

  select status into room_st from public.rooms where id = new.room_id;
  if room_st in ('maintenance', 'blocked') and new.status in ('hold', 'confirmed', 'checked_in') then
    raise exception 'Room is % and cannot be booked', room_st;
  end if;

  select b.id into conflict_id
  from public.bookings b
  where b.room_id = new.room_id
    and b.id is distinct from new.id
    and b.status in ('hold', 'confirmed', 'checked_in')
    and daterange(b.check_in_date, b.check_out_date, '[)') &&
        daterange(new.check_in_date, new.check_out_date, '[)')
  limit 1;

  if conflict_id is not null then
    raise exception 'Double booking prevented: room already reserved for overlapping dates';
  end if;

  return new;
end;
$$;

create trigger bookings_no_overlap
  before insert or update on public.bookings
  for each row execute function public.prevent_double_booking();

-- ========== CHECK-IN / CHECK-OUT ==========
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  room_id uuid not null references public.rooms(id),
  id_verified boolean not null default false,
  additional_guests int not null default 0,
  notes text,
  checked_in_by uuid references public.profiles(id),
  checked_in_at timestamptz not null default now()
);

create table public.check_outs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  final_bill numeric(12,2) not null default 0,
  outstanding numeric(12,2) not null default 0,
  notes text,
  checked_out_by uuid references public.profiles(id),
  checked_out_at timestamptz not null default now()
);

-- ========== SERVICE ITEMS & FOLIO ==========
create table public.service_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_amount numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.service_items (name, default_amount) values
  ('Extra Bed', 500),
  ('Laundry', 200),
  ('Mini Bar', 300),
  ('Room Service', 250),
  ('Early Check-in', 500),
  ('Late Check-out', 500);

create table public.folio_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_item_id uuid references public.service_items(id),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_amount numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  voided boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.touch_booking_on_folio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  folio_sum numeric(12,2);
  b public.bookings%rowtype;
begin
  bid := coalesce(new.booking_id, old.booking_id);
  select * into b from public.bookings where id = bid;
  select coalesce(sum(amount), 0) into folio_sum
  from public.folio_charges where booking_id = bid and voided = false;

  update public.bookings set
    additional_charges = folio_sum,
    subtotal = greatest(
      (room_rate * greatest(check_out_date - check_in_date, 1))
      + extra_bed_charge + folio_sum - discount_amount, 0),
    total_amount = greatest(
      (room_rate * greatest(check_out_date - check_in_date, 1))
      + extra_bed_charge + folio_sum - discount_amount, 0),
    balance_due = greatest(
      greatest(
        (room_rate * greatest(check_out_date - check_in_date, 1))
        + extra_bed_charge + folio_sum - discount_amount, 0)
      - amount_paid, 0),
    updated_at = now()
  where id = bid;

  return coalesce(new, old);
end;
$$;

create trigger folio_charges_recalc
  after insert or update or delete on public.folio_charges
  for each row execute function public.touch_booking_on_folio();

-- ========== ACCOUNTS ==========
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind public.account_kind not null,
  balance numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.accounts (name, kind) values
  ('Cash', 'cash'),
  ('UPI', 'upi'),
  ('Bank', 'bank'),
  ('Card', 'card'),
  ('Accounts Receivable', 'receivable');

create table public.account_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  txn_type text not null check (txn_type in ('credit', 'debit')),
  amount numeric(12,2) not null check (amount > 0),
  description text,
  reference_type text,
  reference_id uuid,
  booking_id uuid references public.bookings(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.apply_account_txn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.txn_type = 'credit' then
    update public.accounts set balance = balance + new.amount where id = new.account_id;
  else
    update public.accounts set balance = balance - new.amount where id = new.account_id;
  end if;
  return new;
end;
$$;

create trigger account_txn_apply
  after insert on public.account_transactions
  for each row execute function public.apply_account_txn();

-- ========== PAYMENTS & REFUNDS ==========
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null,
  reference text,
  notes text,
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  voided boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  booking_id uuid not null references public.bookings(id),
  amount numeric(12,2) not null check (amount > 0),
  reason text,
  method text not null,
  approval_status public.expense_approval not null default 'pending',
  approved_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.after_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc_id uuid;
  method_lower text;
begin
  method_lower := lower(new.method);
  select id into acc_id from public.accounts
  where lower(name) = method_lower or kind::text = method_lower
  limit 1;

  if acc_id is null then
    select id into acc_id from public.accounts where kind = 'cash' limit 1;
  end if;

  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, booking_id, created_by
  ) values (
    acc_id, 'credit', new.amount,
    'Payment for booking', 'payment', new.id, new.booking_id, new.received_by
  );

  update public.bookings set
    amount_paid = amount_paid + new.amount,
    balance_due = greatest(total_amount - (amount_paid + new.amount), 0),
    updated_at = now()
  where id = new.booking_id;

  return new;
end;
$$;

create trigger payments_after_insert
  after insert on public.payments
  for each row when (new.voided = false)
  execute function public.after_payment_insert();

create or replace function public.after_refund_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc_id uuid;
  method_lower text;
  settings_require boolean;
begin
  if new.approval_status is distinct from 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.approval_status = 'approved' then
    return new;
  end if;

  method_lower := lower(new.method);
  select id into acc_id from public.accounts
  where lower(name) = method_lower or kind::text = method_lower
  limit 1;
  if acc_id is null then
    select id into acc_id from public.accounts where kind = 'cash' limit 1;
  end if;

  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, booking_id, created_by
  ) values (
    acc_id, 'debit', new.amount,
    coalesce(new.reason, 'Refund'), 'refund', new.id, new.booking_id, new.created_by
  );

  update public.bookings set
    amount_paid = greatest(amount_paid - new.amount, 0),
    balance_due = total_amount - greatest(amount_paid - new.amount, 0),
    updated_at = now()
  where id = new.booking_id;

  return new;
end;
$$;

create trigger refunds_after_approve
  after insert or update of approval_status on public.refunds
  for each row execute function public.after_refund_approved();

-- ========== INVOICES ==========
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  guest_id uuid not null references public.guests(id),
  invoice_type public.invoice_type not null,
  invoice_number text not null unique,
  status public.invoice_status not null default 'issued',
  customer_gstin text,
  hotel_gstin text,
  taxable_value numeric(12,2) not null default 0,
  cgst_amount numeric(12,2) not null default 0,
  sgst_amount numeric(12,2) not null default 0,
  igst_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  place_of_supply text,
  is_inter_state boolean not null default false,
  notes text,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_amount numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0
);

create table public.tax_details (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  tax_name text not null,
  rate numeric(5,2) not null,
  amount numeric(12,2) not null
);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  credit_note_number text not null unique,
  amount numeric(12,2) not null,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.payment_allocations
  add constraint payment_allocations_invoice_fk
  foreign key (invoice_id) references public.invoices(id);

-- ========== EXPENSES ==========
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

insert into public.expense_categories (name) values
  ('Salary'), ('Electricity'), ('Food Purchase'), ('Maintenance'), ('Supplies'), ('Other');

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id),
  amount numeric(12,2) not null check (amount > 0),
  supplier text,
  payment_method text not null,
  description text,
  bill_path text,
  approval_status public.expense_approval not null default 'not_required',
  approved_by uuid references public.profiles(id),
  expense_date date not null default current_date,
  posted boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.after_expense_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc_id uuid;
  method_lower text;
begin
  if not new.posted then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.posted = true then
    return new;
  end if;

  if new.approval_status = 'pending' then
    return new;
  end if;
  if new.approval_status = 'rejected' then
    return new;
  end if;

  method_lower := lower(new.payment_method);
  select id into acc_id from public.accounts
  where lower(name) = method_lower or kind::text = method_lower
  limit 1;
  if acc_id is null then
    select id into acc_id from public.accounts where kind = 'cash' limit 1;
  end if;

  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, created_by
  ) values (
    acc_id, 'debit', new.amount,
    coalesce(new.description, 'Expense'), 'expense', new.id, new.created_by
  );

  return new;
end;
$$;

create trigger expenses_after_post
  after insert or update of posted, approval_status on public.expenses
  for each row execute function public.after_expense_post();

-- ========== HOUSEKEEPING ==========
create table public.housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id),
  booking_id uuid references public.bookings(id),
  status public.hk_task_status not null default 'pending',
  priority public.priority_level not null default 'medium',
  assigned_to uuid references public.profiles(id),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger hk_tasks_updated_at
  before update on public.housekeeping_tasks
  for each row execute function public.set_updated_at();

-- ========== MAINTENANCE ==========
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id),
  title text not null,
  description text,
  priority public.priority_level not null default 'medium',
  status public.maintenance_status not null default 'open',
  assigned_to uuid references public.profiles(id),
  cost numeric(12,2) not null default 0,
  block_room boolean not null default false,
  reported_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger maintenance_updated_at
  before update on public.maintenance_requests
  for each row execute function public.set_updated_at();

-- ========== AUDIT LOGS ==========
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_details);
end;
$$;

-- ========== BOOKING CODE ==========
create or replace function public.generate_booking_code()
returns trigger
language plpgsql
as $$
begin
  if new.booking_code is null or new.booking_code = '' then
    new.booking_code := 'BK' || to_char(now(), 'YYMMDD') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;
  -- nights is a generated column; compute money totals only
  new.subtotal := greatest(
    (new.room_rate * greatest(new.check_out_date - new.check_in_date, 1))
    + new.extra_bed_charge + new.additional_charges - new.discount_amount, 0);
  new.total_amount := new.subtotal;
  new.balance_due := greatest(new.total_amount - new.amount_paid, 0);
  return new;
end;
$$;

create trigger bookings_before_insert
  before insert on public.bookings
  for each row execute function public.generate_booking_code();

create or replace function public.bookings_recalc_on_update()
returns trigger
language plpgsql
as $$
begin
  new.subtotal := greatest(
    (new.room_rate * greatest(new.check_out_date - new.check_in_date, 1))
    + new.extra_bed_charge + new.additional_charges - new.discount_amount, 0);
  new.total_amount := new.subtotal;
  new.balance_due := greatest(new.total_amount - new.amount_paid, 0);
  return new;
end;
$$;

create trigger bookings_before_update_totals
  before update of room_rate, discount_amount, extra_bed_charge, additional_charges, check_in_date, check_out_date, amount_paid
  on public.bookings
  for each row execute function public.bookings_recalc_on_update();

-- ========== STORAGE BUCKET (run via dashboard or storage API) ==========
-- Buckets: guest-documents, expense-receipts — created in app setup script

-- ========== RLS ==========
alter table public.profiles enable row level security;
alter table public.hotel_settings enable row level security;
alter table public.room_types enable row level security;
alter table public.rooms enable row level security;
alter table public.room_status_history enable row level security;
alter table public.guests enable row level security;
alter table public.guest_documents enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.check_ins enable row level security;
alter table public.check_outs enable row level security;
alter table public.service_items enable row level security;
alter table public.folio_charges enable row level security;
alter table public.accounts enable row level security;
alter table public.account_transactions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.refunds enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.tax_details enable row level security;
alter table public.credit_notes enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.housekeeping_tasks enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.audit_logs enable row level security;

-- Staff can read most tables; writes gated by role where critical
create policy "staff_read_profiles" on public.profiles for select to authenticated using (true);
create policy "owner_update_profiles" on public.profiles for update to authenticated
  using (public.has_role(array['owner','manager']::public.app_role[]) or id = auth.uid());

create policy "staff_all_settings_read" on public.hotel_settings for select to authenticated using (true);
create policy "owner_settings_write" on public.hotel_settings for all to authenticated
  using (public.has_role(array['owner','manager']::public.app_role[]))
  with check (public.has_role(array['owner','manager']::public.app_role[]));

-- Generic staff CRUD for operational tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'room_types','rooms','room_status_history','guests','guest_documents',
    'bookings','booking_status_history','check_ins','check_outs','service_items',
    'folio_charges','accounts','account_transactions','payments','payment_allocations',
    'refunds','invoices','invoice_items','tax_details','credit_notes',
    'expense_categories','expenses','housekeeping_tasks','maintenance_requests','audit_logs'
  ]
  loop
    execute format('create policy staff_select_%s on public.%I for select to authenticated using (public.is_staff())', t, t);
    execute format('create policy staff_insert_%s on public.%I for insert to authenticated with check (public.is_staff())', t, t);
    execute format('create policy staff_update_%s on public.%I for update to authenticated using (public.is_staff())', t, t);
  end loop;
end;
$$;

-- No delete on financial tables for authenticated (protect integrity)
-- Soft void/cancel only via updates

comment on schema public is 'Hotel Cloud Management System Phase 1';
