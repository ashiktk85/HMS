-- Phase 08: housekeeping and maintenance
-- Run in the Supabase SQL Editor after 001-006.
--
-- Housekeeping tasks follow Pending -> Cleaning -> (Inspection) -> Completed, and the room
-- status follows the task. Maintenance follows Open -> In progress -> Completed, can take a
-- room out of service, and can record its cost as an expense (no double entry).
-- Room status is only changed when the room is in the state the workflow expects, so a
-- stale task can never make an occupied or under-repair room "available".

-- ========== schema ==========
alter table public.housekeeping_tasks
  add column if not exists started_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id);

alter table public.maintenance_requests
  add column if not exists started_at timestamptz,
  add column if not exists resolution_note text,
  add column if not exists expense_id uuid references public.expenses(id);

create index if not exists hk_tasks_open_idx on public.housekeeping_tasks (room_id)
  where status in ('pending', 'cleaning', 'inspection');
create index if not exists maintenance_open_idx on public.maintenance_requests (room_id)
  where status in ('open', 'in_progress');

-- ========== housekeeping ==========
create or replace function public.create_hk_task(
  p_room_id uuid,
  p_priority public.priority_level default 'medium',
  p_notes text default null,
  p_assigned_to uuid default null
)
returns uuid
language plpgsql
as $$
declare
  r public.rooms%rowtype;
  tid uuid;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if not found or not r.is_active then raise exception 'Room not found'; end if;
  if r.status in ('maintenance', 'blocked') then
    raise exception 'Room % is %; finish that first', r.room_number, r.status;
  end if;
  if exists (select 1 from public.housekeeping_tasks
             where room_id = r.id and status in ('pending', 'cleaning', 'inspection')) then
    raise exception 'Room % already has an open cleaning task', r.room_number;
  end if;

  insert into public.housekeeping_tasks (room_id, status, priority, notes, assigned_to)
  values (r.id, 'pending', coalesce(p_priority, 'medium'), nullif(trim(p_notes), ''), p_assigned_to)
  returning id into tid;

  -- A free room needing cleaning must not be sold until it is clean.
  -- An occupied room (stay-over clean) keeps its status.
  if r.status in ('available', 'reserved') then
    update public.rooms set status = 'dirty' where id = r.id;
  end if;

  perform public.write_audit('create', 'housekeeping_tasks', tid,
    jsonb_build_object('room_id', r.id, 'priority', p_priority));
  return tid;
end;
$$;

create or replace function public.assign_hk_task(
  p_task_id uuid,
  p_assigned_to uuid,
  p_priority public.priority_level default null
)
returns void
language plpgsql
as $$
declare
  t public.housekeeping_tasks%rowtype;
begin
  select * into t from public.housekeeping_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.status in ('completed', 'cancelled') then raise exception 'This task is already %', t.status; end if;
  update public.housekeeping_tasks
  set assigned_to = p_assigned_to, priority = coalesce(p_priority, priority)
  where id = t.id;
  perform public.write_audit('assign', 'housekeeping_tasks', t.id,
    jsonb_build_object('assigned_to', p_assigned_to, 'priority', p_priority));
end;
$$;

create or replace function public.advance_hk_task(
  p_task_id uuid,
  p_status public.hk_task_status,
  p_note text default null
)
returns void
language plpgsql
as $$
declare
  t public.housekeeping_tasks%rowtype;
  r public.rooms%rowtype;
  allowed boolean;
  new_room_status public.room_status;
begin
  select * into t from public.housekeeping_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;

  allowed := case t.status
    when 'pending'    then p_status in ('cleaning', 'cancelled')
    when 'cleaning'   then p_status in ('inspection', 'completed', 'cancelled')
    when 'inspection' then p_status in ('completed', 'cleaning', 'cancelled')
    else false
  end;
  if not allowed then
    raise exception 'A % task cannot move to %', t.status, p_status;
  end if;

  update public.housekeeping_tasks
  set status = p_status,
      started_at = case when p_status = 'cleaning' and started_at is null then now() else started_at end,
      completed_at = case when p_status = 'completed' then now() else completed_at end,
      completed_by = case when p_status = 'completed' then auth.uid() else completed_by end,
      notes = case when nullif(trim(p_note), '') is null then notes
                   else concat_ws(E'\n', notes, trim(p_note)) end
  where id = t.id;

  select * into r from public.rooms where id = t.room_id for update;
  new_room_status := case p_status
    when 'cleaning' then 'cleaning'
    when 'inspection' then 'inspection'
    when 'completed' then 'available'
    when 'cancelled' then null
  end;
  -- Only move a room that is in the cleaning cycle. Occupied, maintenance and blocked rooms
  -- are left alone, so a stay-over clean or an old task can't free up a room by mistake.
  if new_room_status is not null and r.status in ('dirty', 'cleaning', 'inspection') then
    update public.rooms set status = new_room_status where id = r.id;
  end if;

  perform public.write_audit('status_change', 'housekeeping_tasks', t.id,
    jsonb_build_object('from', t.status, 'to', p_status, 'room_id', t.room_id));
end;
$$;

-- ========== maintenance ==========
create or replace function public.report_maintenance(
  p_room_id uuid,
  p_title text,
  p_description text default null,
  p_priority public.priority_level default 'medium',
  p_assigned_to uuid default null,
  p_block_room boolean default false
)
returns uuid
language plpgsql
as $$
declare
  r public.rooms%rowtype;
  mid uuid;
begin
  if coalesce(trim(p_title), '') = '' then raise exception 'Describe the issue in the title'; end if;
  if p_room_id is not null then
    select * into r from public.rooms where id = p_room_id for update;
    if not found then raise exception 'Room not found'; end if;
  end if;
  if coalesce(p_block_room, false) then
    if p_room_id is null then raise exception 'Choose the room to take out of service'; end if;
    if r.status = 'occupied' then
      raise exception 'Room % has a guest in it. Move the guest (change room) before taking it out of service.', r.room_number;
    end if;
  end if;

  insert into public.maintenance_requests (
    room_id, title, description, priority, assigned_to, block_room, reported_by
  ) values (
    p_room_id, trim(p_title), nullif(trim(p_description), ''), coalesce(p_priority, 'medium'),
    p_assigned_to, coalesce(p_block_room, false), auth.uid()
  ) returning id into mid;

  if coalesce(p_block_room, false) then
    update public.rooms set status = 'maintenance' where id = p_room_id;
  end if;

  perform public.write_audit('create', 'maintenance_requests', mid, jsonb_build_object(
    'room_id', p_room_id, 'title', trim(p_title), 'block_room', coalesce(p_block_room, false)));
  return mid;
end;
$$;

create or replace function public.advance_maintenance(
  p_request_id uuid,
  p_status public.maintenance_status,
  p_assigned_to uuid default null,
  p_cost numeric default null,
  p_note text default null,
  p_expense_method_id uuid default null
)
returns void
language plpgsql
as $$
declare
  m public.maintenance_requests%rowtype;
  r public.rooms%rowtype;
  allowed boolean;
  v_cost numeric(12,2);
  cat uuid;
  eid uuid;
begin
  select * into m from public.maintenance_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;

  allowed := p_status = m.status or case m.status
    when 'open'        then p_status in ('in_progress', 'completed', 'cancelled')
    when 'in_progress' then p_status in ('completed', 'cancelled')
    else false
  end;
  if not allowed then raise exception 'A % request cannot move to %', m.status, p_status; end if;
  if m.status in ('completed', 'cancelled') then raise exception 'This request is already %', m.status; end if;

  v_cost := round(coalesce(p_cost, m.cost), 2);
  if v_cost < 0 then raise exception 'Cost cannot be negative'; end if;

  -- Optionally record the cost as an expense once, when the job is completed.
  if p_status = 'completed' and p_expense_method_id is not null and v_cost > 0 and m.expense_id is null then
    select id into cat from public.expense_categories
    where lower(name) = 'maintenance' and is_active limit 1;
    if cat is null then raise exception 'Add an active "Maintenance" expense category in Settings first'; end if;
    eid := public.record_expense(cat, v_cost, p_expense_method_id, public.hotel_today(),
                                 null, 'Maintenance: ' || m.title, null);
  end if;

  update public.maintenance_requests
  set status = p_status,
      assigned_to = coalesce(p_assigned_to, assigned_to),
      cost = v_cost,
      started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
      completed_at = case when p_status in ('completed', 'cancelled') then now() else completed_at end,
      resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note),
      expense_id = coalesce(eid, expense_id)
  where id = m.id;

  -- Release the room when the last open job that blocks it is closed.
  if m.block_room and m.room_id is not null and p_status in ('completed', 'cancelled') then
    select * into r from public.rooms where id = m.room_id for update;
    if r.status = 'maintenance' and not exists (
      select 1 from public.maintenance_requests x
      where x.room_id = m.room_id and x.id <> m.id and x.block_room
        and x.status in ('open', 'in_progress')
    ) then
      update public.rooms set status = 'available' where id = r.id;
    end if;
  end if;

  perform public.write_audit('status_change', 'maintenance_requests', m.id, jsonb_build_object(
    'from', m.status, 'to', p_status, 'cost', v_cost, 'expense_id', eid));
end;
$$;

revoke execute on function
  public.create_hk_task(uuid, public.priority_level, text, uuid),
  public.assign_hk_task(uuid, uuid, public.priority_level),
  public.advance_hk_task(uuid, public.hk_task_status, text),
  public.report_maintenance(uuid, text, text, public.priority_level, uuid, boolean),
  public.advance_maintenance(uuid, public.maintenance_status, uuid, numeric, text, uuid)
from public, anon;
grant execute on function
  public.create_hk_task(uuid, public.priority_level, text, uuid),
  public.assign_hk_task(uuid, uuid, public.priority_level),
  public.advance_hk_task(uuid, public.hk_task_status, text),
  public.report_maintenance(uuid, text, text, public.priority_level, uuid, boolean),
  public.advance_maintenance(uuid, public.maintenance_status, uuid, numeric, text, uuid)
to authenticated;

notify pgrst, 'reload schema';
