-- Phase 11: replace room types with two room categories, add AC / non-AC to bookings
-- Run in the Supabase SQL Editor after 001-008.
--
-- * rooms.category: 'regular' (customer rooms) or 'driver' (driver rooms).
-- * rooms now carry their own base_rate and max_occupancy (copied from the old room type).
-- * rooms.room_type_id becomes optional. The room_types table is kept for history but is
--   no longer used by the app.
-- * bookings.ac_option: whether the guest wants the AC on. Non-AC stays are switched off.
-- * hotel_report() groups by category instead of room type.

do $$ begin
  create type public.room_category as enum ('regular', 'driver');
exception when duplicate_object then null; end $$;

alter table public.rooms
  add column if not exists category public.room_category not null default 'regular',
  add column if not exists base_rate numeric(12,2) not null default 0,
  add column if not exists max_occupancy int not null default 2;

update public.rooms r
   set base_rate = t.base_rate, max_occupancy = t.max_occupancy
  from public.room_types t
 where t.id = r.room_type_id and r.base_rate = 0;

alter table public.rooms alter column room_type_id drop not null;

do $$ begin
  create type public.ac_option as enum ('ac', 'non_ac');
exception when duplicate_object then null; end $$;

alter table public.bookings
  add column if not exists ac_option public.ac_option not null default 'ac';

create or replace function public.hotel_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
as $$
declare
  n_days int;
  n_rooms int;
  ts_from timestamptz;
  ts_to timestamptz;
  res jsonb;
begin
  if p_from is null or p_to is null then raise exception 'Choose a date range'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  n_days := p_to - p_from + 1;
  if n_days > 366 then raise exception 'Choose a range of one year or less'; end if;

  select count(*) into n_rooms from public.rooms where is_active;
  ts_from := (p_from::text || ' 00:00:00+05:30')::timestamptz;
  ts_to := ((p_to + 1)::text || ' 00:00:00+05:30')::timestamptz;

  with sold as (
    select b.id, b.room_id, b.source, b.status, b.total_amount, b.room_rate,
           greatest(0, least(b.check_out_date, p_to + 1) - greatest(b.check_in_date, p_from)) as ov,
           (b.check_out_date - b.check_in_date) as n,
           b.discount_amount
    from public.bookings b
    where b.status in ('confirmed', 'checked_in', 'checked_out')
      and b.check_in_date <= p_to and b.check_out_date > p_from
  ),
  sold_rev as (
    select s.*, greatest(s.ov * s.room_rate - s.discount_amount * s.ov / s.n, 0) as rev from sold s
  ),
  totals as (
    select coalesce(sum(ov), 0)::int as nights, coalesce(sum(rev), 0) as rev from sold_rev
  ),
  per_room as (
    select r.id, r.room_number, case r.category when 'driver' then 'Driver room' else 'Regular room' end as type_name,
           coalesce(sum(sr.ov), 0)::int as nights, coalesce(sum(sr.rev), 0) as rev
    from public.rooms r
    left join sold_rev sr on sr.room_id = r.id
    where r.is_active
    group by r.id, r.room_number, r.category
  ),
  days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ),
  daily as (
    select dy.day,
           (select count(*) from sold s2
            join public.bookings b2 on b2.id = s2.id
            where b2.check_in_date <= dy.day and b2.check_out_date > dy.day)::int as sold
    from days dy
  ),
  src as (
    select b.source, count(*) as cnt, coalesce(sum(b.total_amount), 0) as val
    from public.bookings b
    where b.status in ('confirmed', 'checked_in', 'checked_out')
      and b.check_in_date between p_from and p_to
    group by b.source
  ),
  cancels as (
    select b.status, count(*) as cnt, coalesce(sum(b.subtotal), 0) as val
    from public.bookings b
    where b.status in ('cancelled', 'no_show') and b.check_in_date between p_from and p_to
    group by b.status
  ),
  pay as (
    select method, sum(received) as received, sum(refunded) as refunded
    from (
      select p.method, p.amount as received, 0::numeric as refunded
      from public.payments p
      where not p.voided and p.received_at >= ts_from and p.received_at < ts_to
      union all
      select r.method, 0::numeric, r.amount
      from public.refunds r
      where r.approval_status = 'approved'
        and coalesce(r.decided_at, r.created_at) >= ts_from
        and coalesce(r.decided_at, r.created_at) < ts_to
    ) u
    group by method
  ),
  exps as (
    select c.name, coalesce(sum(e.amount), 0) as amt, count(*) as cnt
    from public.expenses e
    join public.expense_categories c on c.id = e.category_id
    where e.posted and not e.reversed and e.expense_date between p_from and p_to
    group by c.name
  ),
  inv as (
    select i.invoice_type, count(*) as cnt,
           coalesce(sum(i.taxable_value), 0) as taxable,
           coalesce(sum(i.cgst_amount), 0) as cgst,
           coalesce(sum(i.sgst_amount), 0) as sgst,
           coalesce(sum(i.igst_amount), 0) as igst,
           coalesce(sum(i.total_amount), 0) as total
    from public.invoices i
    where i.status in ('issued', 'credited') and i.issued_at >= ts_from and i.issued_at < ts_to
    group by i.invoice_type
  ),
  cn as (
    select count(*) as cnt,
           coalesce(sum(taxable_value), 0) as taxable,
           coalesce(sum(cgst_amount), 0) as cgst,
           coalesce(sum(sgst_amount), 0) as sgst,
           coalesce(sum(igst_amount), 0) as igst,
           coalesce(sum(amount), 0) as total
    from public.credit_notes where created_at >= ts_from and created_at < ts_to
  ),
  outstanding as (
    select count(*) as cnt, coalesce(sum(balance_due), 0) as total
    from public.bookings
    where balance_due > 0 and status in ('hold', 'confirmed', 'checked_in', 'checked_out')
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', n_days, 'rooms', n_rooms,
    'room_nights_sold', (select nights from totals),
    'room_nights_available', n_rooms * n_days,
    'room_revenue', (select rev from totals),
    'occupancy_pct', round(100.0 * (select nights from totals) / nullif(n_rooms * n_days, 0), 1),
    'adr', round((select rev from totals) / nullif((select nights from totals), 0), 2),
    'revpar', round((select rev from totals) / nullif(n_rooms * n_days, 0), 2),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', day, 'sold', sold) order by day), '[]'::jsonb) from daily),
    'by_room', (select coalesce(jsonb_agg(jsonb_build_object(
        'room_number', room_number, 'type', type_name, 'nights', nights, 'revenue', rev,
        'occupancy_pct', round(100.0 * nights / n_days, 1)) order by room_number), '[]'::jsonb) from per_room),
    'by_type', (select coalesce(jsonb_agg(x order by x ->> 'type'), '[]'::jsonb) from (
        select jsonb_build_object('type', type_name, 'rooms', count(*), 'nights', sum(nights),
               'revenue', sum(rev),
               'occupancy_pct', round(100.0 * sum(nights) / nullif(count(*) * n_days, 0), 1),
               'adr', round(sum(rev) / nullif(sum(nights), 0), 2),
               'revpar', round(sum(rev) / nullif(count(*) * n_days, 0), 2)) as x
        from per_room group by type_name) q),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'bookings', cnt, 'value', val) order by cnt desc), '[]'::jsonb) from src),
    'cancellations', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'bookings', cnt, 'value', val)), '[]'::jsonb) from cancels),
    'payments_by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'received', received, 'refunded', refunded) order by method), '[]'::jsonb) from pay),
    'received_total', (select coalesce(sum(received), 0) from pay),
    'refunded_total', (select coalesce(sum(refunded), 0) from pay),
    'expenses_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', name, 'amount', amt, 'count', cnt) order by amt desc), '[]'::jsonb) from exps),
    'expenses_total', (select coalesce(sum(amt), 0) from exps),
    'gst_invoices', (select coalesce(jsonb_agg(jsonb_build_object(
        'type', invoice_type, 'count', cnt, 'taxable', taxable, 'cgst', cgst, 'sgst', sgst,
        'igst', igst, 'total', total) order by invoice_type), '[]'::jsonb) from inv),
    'credit_notes', (select jsonb_build_object('count', cnt, 'taxable', taxable, 'cgst', cgst,
        'sgst', sgst, 'igst', igst, 'total', total) from cn),
    'voided_invoices', (select count(*) from public.invoices
        where status = 'voided' and issued_at >= ts_from and issued_at < ts_to),
    'income', (select coalesce(sum(taxable), 0) from inv) - (select taxable from cn),
    'outstanding', (select jsonb_build_object('count', cnt, 'total', total) from outstanding)
  ) into res;

  return res;
end;
$$;

revoke execute on function public.hotel_report(date, date) from public, anon;
grant execute on function public.hotel_report(date, date) to authenticated;

