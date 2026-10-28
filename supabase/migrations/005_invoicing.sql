-- Phase 06: GST / Non-GST invoicing
-- Run in the Supabase SQL Editor after 001-004.
--
-- 1. Gapless invoice / credit-note numbers per financial year (Apr-Mar), allocated
--    atomically inside the same transaction that creates the document.
-- 2. GST is calculated in ONE place (calc_invoice) used for both the preview and the
--    issued invoice. Room-type lines use the room GST rates from Settings; service
--    lines (folio, additional charges) use the service GST rate.
-- 3. An issued invoice adds its tax to the booking (bookings.tax_total) and credit
--    notes reduce it (bookings.credited_total), so booking balance, payments and
--    accounts stay in step with the invoice.
-- 4. One active invoice per booking; charges are frozen while an invoice exists.

-- ========== schema changes ==========
alter table public.hotel_settings
  add column if not exists service_gst_rate numeric(5,2) not null default 18.00,
  add column if not exists credit_note_prefix text not null default 'CN';

alter table public.invoices
  add column if not exists billing_name text,
  add column if not exists billing_address text,
  add column if not exists fiscal_year text;

alter table public.invoice_items
  add column if not exists tax_rate numeric(5,2) not null default 0,
  add column if not exists sac_code text;

alter table public.credit_notes
  add column if not exists taxable_value numeric(12,2) not null default 0,
  add column if not exists cgst_amount numeric(12,2) not null default 0,
  add column if not exists sgst_amount numeric(12,2) not null default 0,
  add column if not exists igst_amount numeric(12,2) not null default 0,
  add column if not exists fiscal_year text;

update public.credit_notes set taxable_value = amount where taxable_value = 0;

alter table public.bookings
  add column if not exists tax_total numeric(12,2) not null default 0,
  add column if not exists credited_total numeric(12,2) not null default 0;

create unique index if not exists invoices_one_active_per_booking
  on public.invoices (booking_id) where status in ('issued', 'credited');

-- ========== booking totals include invoice tax and credit notes ==========
create or replace function public.booking_gross(
  rate numeric, ci date, co date,
  extra_bed numeric, additional numeric, folio numeric, discount numeric,
  tax numeric, credited numeric
)
returns numeric
language sql
immutable
as $$
  select greatest(
    greatest(rate * greatest(co - ci, 1) + extra_bed + additional + folio - discount, 0)
      + tax - credited,
    0)
$$;

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
    new.extra_bed_charge, new.additional_charges, new.folio_total, new.discount_amount, 0, 0);
  new.total_amount := public.booking_gross(
    new.room_rate, new.check_in_date, new.check_out_date,
    new.extra_bed_charge, new.additional_charges, new.folio_total, new.discount_amount,
    new.tax_total, new.credited_total);
  new.balance_due := greatest(new.total_amount - new.amount_paid, 0);
  return new;
end;
$$;

create or replace function public.bookings_recalc_on_update()
returns trigger
language plpgsql
as $$
begin
  -- subtotal = pre-tax amount; total_amount = subtotal + invoice tax - credit notes.
  new.subtotal := public.booking_gross(
    new.room_rate, new.check_in_date, new.check_out_date,
    new.extra_bed_charge, new.additional_charges, new.folio_total, new.discount_amount, 0, 0);
  new.total_amount := public.booking_gross(
    new.room_rate, new.check_in_date, new.check_out_date,
    new.extra_bed_charge, new.additional_charges, new.folio_total, new.discount_amount,
    new.tax_total, new.credited_total);
  new.balance_due := greatest(new.total_amount - new.amount_paid, 0);
  return new;
end;
$$;

drop trigger if exists bookings_before_update_totals on public.bookings;
create trigger bookings_before_update_totals
  before update of room_rate, discount_amount, extra_bed_charge, additional_charges,
    folio_total, tax_total, credited_total, check_in_date, check_out_date, amount_paid
  on public.bookings
  for each row execute function public.bookings_recalc_on_update();

drop function if exists public.booking_gross(numeric, date, date, numeric, numeric, numeric, numeric);

-- Existing invoices/credit notes (test data): carry their tax into the bookings.
update public.bookings b
set tax_total = coalesce((
      select sum(i.cgst_amount + i.sgst_amount + i.igst_amount)
      from public.invoices i where i.booking_id = b.id and i.status in ('issued', 'credited')), 0),
    credited_total = coalesce((
      select sum(c.amount) from public.credit_notes c
      join public.invoices i on i.id = c.invoice_id where i.booking_id = b.id), 0);

-- ========== numbering ==========
create table if not exists public.invoice_counters (
  series text not null,
  fiscal_year text not null,
  last_no int not null default 0,
  primary key (series, fiscal_year)
);
alter table public.invoice_counters enable row level security;  -- no policies: only the function below touches it

create or replace function public.fiscal_year_label(d date default public.hotel_today())
returns text
language sql
immutable
as $$
  select case when extract(month from d) >= 4
    then to_char(extract(year from d)::int % 100, 'FM00') || '-' || to_char((extract(year from d)::int + 1) % 100, 'FM00')
    else to_char((extract(year from d)::int - 1) % 100, 'FM00') || '-' || to_char(extract(year from d)::int % 100, 'FM00')
  end
$$;

-- Runs inside the caller's transaction: if the document insert fails, the number is not consumed.
create or replace function public.next_document_number(p_series text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fy text := public.fiscal_year_label();
  n int;
begin
  insert into public.invoice_counters (series, fiscal_year, last_no)
  values (p_series, fy, 1)
  on conflict (series, fiscal_year)
  do update set last_no = public.invoice_counters.last_no + 1
  returning last_no into n;
  return p_prefix || '/' || fy || '/' || lpad(n::text, 5, '0');
end;
$$;

-- ========== calculation (used for preview and for issuing) ==========
create or replace function public.calc_invoice(
  p_booking_id uuid,
  p_type public.invoice_type,
  p_inter boolean
)
returns jsonb
language plpgsql
stable
as $$
declare
  b public.bookings%rowtype;
  s public.hotel_settings%rowtype;
  r public.rooms%rowtype;
  nights int;
  lines jsonb := '[]'::jsonb;
  f record;
  room_gross numeric := 0;
  svc_gross numeric := 0;
  disc_room numeric;
  disc_svc numeric;
  tx_room numeric;
  tx_svc numeric;
  room_pct numeric := 0;
  svc_pct numeric := 0;
  r_cgst numeric := 0; r_sgst numeric := 0; r_igst numeric := 0;
  s_cgst numeric := 0; s_sgst numeric := 0; s_igst numeric := 0;
  tax_rows jsonb;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  select * into s from public.hotel_settings limit 1;
  select * into r from public.rooms where id = b.room_id;
  nights := greatest(b.check_out_date - b.check_in_date, 1);

  if p_type = 'gst' then
    room_pct := case when p_inter then s.igst_rate else s.cgst_rate + s.sgst_rate end;
    svc_pct := s.service_gst_rate;
  end if;

  room_gross := round(b.room_rate * nights, 2);
  lines := lines || jsonb_build_object(
    'description', format('Room accommodation, Room %s (%s night%s)', r.room_number, nights, case when nights = 1 then '' else 's' end),
    'quantity', nights, 'unit_amount', b.room_rate, 'amount', room_gross,
    'tax_rate', room_pct, 'sac_code', '996311');

  if b.extra_bed_charge > 0 then
    lines := lines || jsonb_build_object('description', 'Extra bed', 'quantity', 1,
      'unit_amount', b.extra_bed_charge, 'amount', b.extra_bed_charge,
      'tax_rate', room_pct, 'sac_code', '996311');
    room_gross := room_gross + b.extra_bed_charge;
  end if;

  if b.additional_charges > 0 then
    lines := lines || jsonb_build_object('description', 'Additional charges', 'quantity', 1,
      'unit_amount', b.additional_charges, 'amount', b.additional_charges,
      'tax_rate', svc_pct, 'sac_code', null);
    svc_gross := svc_gross + b.additional_charges;
  end if;

  for f in
    select * from public.folio_charges where booking_id = b.id and voided = false order by created_at
  loop
    lines := lines || jsonb_build_object('description', f.description, 'quantity', f.quantity,
      'unit_amount', f.unit_amount, 'amount', f.amount, 'tax_rate', svc_pct, 'sac_code', null);
    svc_gross := svc_gross + f.amount;
  end loop;

  -- Discount is taken off the accommodation first, any remainder off the services.
  disc_room := least(b.discount_amount, room_gross);
  disc_svc := b.discount_amount - disc_room;
  if disc_room > 0 then
    lines := lines || jsonb_build_object('description', 'Discount (accommodation)', 'quantity', 1,
      'unit_amount', -disc_room, 'amount', -disc_room, 'tax_rate', room_pct, 'sac_code', '996311');
  end if;
  if disc_svc > 0 then
    lines := lines || jsonb_build_object('description', 'Discount (services)', 'quantity', 1,
      'unit_amount', -disc_svc, 'amount', -disc_svc, 'tax_rate', svc_pct, 'sac_code', null);
  end if;

  tx_room := room_gross - disc_room;
  tx_svc := svc_gross - disc_svc;

  -- Tax is rounded once per rate group (accommodation, services), not per line.
  if p_type = 'gst' then
    if p_inter then
      r_igst := round(tx_room * s.igst_rate / 100, 2);
      s_igst := round(tx_svc * s.service_gst_rate / 100, 2);
    else
      r_cgst := round(tx_room * s.cgst_rate / 100, 2);
      r_sgst := round(tx_room * s.sgst_rate / 100, 2);
      s_cgst := round(tx_svc * (s.service_gst_rate / 2) / 100, 2);
      s_sgst := round(tx_svc * (s.service_gst_rate / 2) / 100, 2);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', name, 'rate', rate, 'taxable', taxable, 'amount', amt) order by name, rate), '[]'::jsonb)
  into tax_rows
  from (
    select name, rate, sum(taxable) as taxable, sum(amt) as amt
    from (values
      ('CGST', s.cgst_rate, tx_room, r_cgst),
      ('SGST', s.sgst_rate, tx_room, r_sgst),
      ('IGST', s.igst_rate, tx_room, r_igst),
      ('CGST', s.service_gst_rate / 2, tx_svc, s_cgst),
      ('SGST', s.service_gst_rate / 2, tx_svc, s_sgst),
      ('IGST', s.service_gst_rate, tx_svc, s_igst)
    ) as v(name, rate, taxable, amt)
    where amt <> 0
    group by name, rate
  ) t;

  return jsonb_build_object(
    'type', p_type,
    'inter_state', p_inter,
    'lines', lines,
    'taxable_value', tx_room + tx_svc,
    'cgst', r_cgst + s_cgst,
    'sgst', r_sgst + s_sgst,
    'igst', r_igst + s_igst,
    'tax_total', r_cgst + s_cgst + r_sgst + s_sgst + r_igst + s_igst,
    'total', tx_room + tx_svc + r_cgst + s_cgst + r_sgst + s_sgst + r_igst + s_igst,
    'tax_rows', tax_rows);
end;
$$;

-- issue_invoice and create_credit_note are SECURITY DEFINER so they can allocate the
-- document number (next_document_number is not callable directly, which would burn numbers).
-- They check the caller's role and every rule themselves; auth.uid() is still the caller.
-- ========== issue an invoice ==========
create or replace function public.issue_invoice(
  p_booking_id uuid,
  p_type public.invoice_type,
  p_inter boolean,
  p_billing_name text default null,
  p_billing_gstin text default null,
  p_billing_address text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  s public.hotel_settings%rowtype;
  g public.guests%rowtype;
  calc jsonb;
  inv_id uuid;
  num text;
  gstin text;
  ln jsonb;
  tr jsonb;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('checked_in', 'checked_out') then
    raise exception 'Invoice a booking once the guest has checked in (this one is %)', b.status;
  end if;
  if exists (select 1 from public.invoices where booking_id = b.id and status in ('issued', 'credited')) then
    raise exception 'This booking already has an invoice. Void it first to issue a new one.';
  end if;

  select * into s from public.hotel_settings limit 1;
  select * into g from public.guests where id = b.guest_id;

  gstin := nullif(upper(trim(coalesce(p_billing_gstin, ''))), '');
  if p_type = 'gst' then
    if coalesce(trim(s.gstin), '') = '' then
      raise exception 'Set the hotel GSTIN in Settings before issuing GST invoices';
    end if;
    if gstin is not null and gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
      raise exception 'The customer GSTIN is not valid';
    end if;
  else
    gstin := null;
  end if;

  calc := public.calc_invoice(b.id, p_type, coalesce(p_inter, false) and p_type = 'gst');
  if (calc ->> 'total')::numeric <= 0 then raise exception 'There is nothing to invoice'; end if;

  num := public.next_document_number(
    case when p_type = 'gst' then 'gst' else 'non_gst' end,
    case when p_type = 'gst' then s.gst_invoice_prefix else s.non_gst_invoice_prefix end);

  insert into public.invoices (
    booking_id, guest_id, invoice_type, invoice_number, status,
    customer_gstin, hotel_gstin, billing_name, billing_address,
    taxable_value, cgst_amount, sgst_amount, igst_amount, total_amount,
    is_inter_state, notes, issued_by, fiscal_year
  ) values (
    b.id, b.guest_id, p_type, num, 'issued',
    gstin, case when p_type = 'gst' then s.gstin end,
    coalesce(nullif(trim(p_billing_name), ''), g.full_name),
    coalesce(nullif(trim(p_billing_address), ''), g.address),
    (calc ->> 'taxable_value')::numeric, (calc ->> 'cgst')::numeric,
    (calc ->> 'sgst')::numeric, (calc ->> 'igst')::numeric, (calc ->> 'total')::numeric,
    coalesce(p_inter, false) and p_type = 'gst', nullif(trim(p_notes), ''), auth.uid(),
    public.fiscal_year_label()
  ) returning id into inv_id;

  for ln in select * from jsonb_array_elements(calc -> 'lines') loop
    insert into public.invoice_items (invoice_id, description, quantity, unit_amount, amount, tax_rate, sac_code)
    values (inv_id, ln ->> 'description', (ln ->> 'quantity')::numeric, (ln ->> 'unit_amount')::numeric,
            (ln ->> 'amount')::numeric, (ln ->> 'tax_rate')::numeric, ln ->> 'sac_code');
  end loop;

  for tr in select * from jsonb_array_elements(calc -> 'tax_rows') loop
    insert into public.tax_details (invoice_id, tax_name, rate, amount)
    values (inv_id, tr ->> 'name', (tr ->> 'rate')::numeric, (tr ->> 'amount')::numeric);
  end loop;

  -- The booking total now includes the invoice tax (recomputed by the bookings trigger).
  update public.bookings set tax_total = (calc ->> 'tax_total')::numeric where id = b.id;

  perform public.write_audit('create', 'invoices', inv_id, jsonb_build_object(
    'invoice_number', num, 'type', p_type, 'total', (calc ->> 'total')::numeric, 'booking_id', b.id));
  return inv_id;
end;
$$;

-- ========== void an invoice ==========
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  i public.invoices%rowtype;
begin
  if not public.has_role(array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'Only the owner, a manager or the accountant can void an invoice';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void an invoice'; end if;

  select * into i from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status = 'voided' then raise exception 'This invoice is already voided'; end if;
  if exists (select 1 from public.credit_notes where invoice_id = i.id) then
    raise exception 'This invoice has credit notes, so it cannot be voided';
  end if;

  update public.invoices
  set status = 'voided', voided_at = now(), void_reason = trim(p_reason)
  where id = i.id;
  update public.bookings set tax_total = 0 where id = i.booking_id;

  perform public.write_audit('void', 'invoices', i.id, jsonb_build_object(
    'invoice_number', i.invoice_number, 'total', i.total_amount, 'reason', trim(p_reason)));
end;
$$;

-- ========== credit note ==========
create or replace function public.create_credit_note(
  p_invoice_id uuid,
  p_taxable numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.invoices%rowtype;
  s public.hotel_settings%rowtype;
  amt numeric(12,2);
  taken_t numeric; taken_c numeric; taken_s numeric; taken_i numeric;
  remaining numeric;
  c numeric; sg numeric; ig numeric;
  cn_id uuid;
  num text;
  total numeric;
begin
  if not public.has_role(array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'Only the owner, a manager or the accountant can issue a credit note';
  end if;
  amt := round(p_taxable, 2);
  if amt is null or amt <= 0 then raise exception 'Enter a credit amount above zero'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for a credit note'; end if;

  select * into i from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status <> 'issued' then
    raise exception 'Credit notes can only be raised against an issued invoice (this one is %)', i.status;
  end if;

  select coalesce(sum(taxable_value), 0), coalesce(sum(cgst_amount), 0),
         coalesce(sum(sgst_amount), 0), coalesce(sum(igst_amount), 0)
  into taken_t, taken_c, taken_s, taken_i
  from public.credit_notes where invoice_id = i.id;

  remaining := i.taxable_value - taken_t;
  if amt > remaining then
    raise exception 'Only % (before tax) can still be credited on this invoice', remaining;
  end if;

  if amt = remaining then
    -- Final credit takes whatever tax is left, so rounding never leaves a remainder.
    c := i.cgst_amount - taken_c; sg := i.sgst_amount - taken_s; ig := i.igst_amount - taken_i;
  else
    c := round(amt / i.taxable_value * i.cgst_amount, 2);
    sg := round(amt / i.taxable_value * i.sgst_amount, 2);
    ig := round(amt / i.taxable_value * i.igst_amount, 2);
  end if;
  total := amt + c + sg + ig;

  select * into s from public.hotel_settings limit 1;
  num := public.next_document_number('credit_note', s.credit_note_prefix);

  insert into public.credit_notes (
    invoice_id, credit_note_number, amount, taxable_value,
    cgst_amount, sgst_amount, igst_amount, reason, created_by, fiscal_year
  ) values (
    i.id, num, total, amt, c, sg, ig, trim(p_reason), auth.uid(), public.fiscal_year_label()
  ) returning id into cn_id;

  update public.bookings set credited_total = credited_total + total where id = i.booking_id;
  if amt = remaining then
    update public.invoices set status = 'credited' where id = i.id;
  end if;

  perform public.write_audit('credit_note', 'invoices', i.id, jsonb_build_object(
    'credit_note_number', num, 'taxable', amt, 'total', total, 'reason', trim(p_reason)));
  return cn_id;
end;
$$;

-- ========== freeze charges once invoiced ==========
create or replace function public.guard_folio_when_invoiced()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.invoices
    where booking_id = new.booking_id and status in ('issued', 'credited')
  ) then
    raise exception 'This booking has an invoice. Void the invoice before changing its charges.';
  end if;
  return new;
end;
$$;

drop trigger if exists folio_charges_invoice_guard on public.folio_charges;
create trigger folio_charges_invoice_guard
  before insert or update on public.folio_charges
  for each row execute function public.guard_folio_when_invoiced();

-- ========== permissions ==========
revoke execute on function
  public.calc_invoice(uuid, public.invoice_type, boolean),
  public.issue_invoice(uuid, public.invoice_type, boolean, text, text, text, text),
  public.void_invoice(uuid, text),
  public.create_credit_note(uuid, numeric, text),
  public.next_document_number(text, text)
from public, anon;
grant execute on function
  public.calc_invoice(uuid, public.invoice_type, boolean),
  public.issue_invoice(uuid, public.invoice_type, boolean, text, text, text, text),
  public.void_invoice(uuid, text),
  public.create_credit_note(uuid, numeric, text)
to authenticated;

notify pgrst, 'reload schema';
