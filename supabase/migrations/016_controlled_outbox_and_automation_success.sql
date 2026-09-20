create or replace function crm.claim_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.outbox_events%rowtype;
begin
  perform crm.require_service_role();
  if p_event_id is null or nullif(btrim(p_worker_id), '') is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select event.* into v_event
  from public.outbox_events event
  join public.organizations organization
    on organization.id = event.organization_id and organization.status = 'active'
  where event.id = p_event_id
  for update of event;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_event.status = 'processing'
    and v_event.locked_by = btrim(p_worker_id)
  then
    return v_event;
  end if;

  if v_event.status = 'processing'
    and v_event.locked_at < now() - interval '15 minutes'
  then
    update public.outbox_events set
      status = case
        when attempts >= max_attempts then 'dead_letter'::public.outbox_status
        else 'pending'::public.outbox_status
      end,
      available_at = case
        when attempts >= max_attempts then available_at
        else now()
      end,
      locked_at = null,
      locked_by = null,
      last_error_code = 'STALE_WORKER_LOCK',
      last_error_message = 'Recovered before controlled event claim.'
    where id = p_event_id
    returning * into v_event;
  end if;

  if v_event.status <> 'pending'
    or v_event.available_at > now()
    or v_event.attempts >= v_event.max_attempts
  then
    raise exception using errcode = '55000', message = 'OUTBOX_EVENT_NOT_CLAIMABLE';
  end if;

  update public.outbox_events set
    status = 'processing',
    locked_at = now(),
    locked_by = btrim(p_worker_id),
    attempts = attempts + 1
  where id = p_event_id
  returning * into v_event;
  return v_event;
end;
$$;

create or replace function crm.log_automation_success(
  p_organization_id uuid,
  p_workflow_key text,
  p_external_execution_id text,
  p_outbox_event_id uuid default null,
  p_started_at timestamptz default now(),
  p_attempt integer default 1,
  p_metrics jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform crm.require_service_role();
  if nullif(btrim(p_workflow_key), '') is null
    or nullif(btrim(p_external_execution_id), '') is null
    or p_attempt < 1
    or jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metrics, '{}'::jsonb)::text) > 8192
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if not exists (
    select 1 from public.organizations
    where id = p_organization_id and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE';
  end if;
  if p_outbox_event_id is not null and not exists (
    select 1 from public.outbox_events
    where organization_id = p_organization_id and id = p_outbox_event_id
  ) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  insert into public.automation_runs (
    organization_id,
    workflow_key,
    external_execution_id,
    outbox_event_id,
    status,
    attempt,
    started_at,
    completed_at,
    error_code,
    error_message,
    metrics
  ) values (
    p_organization_id,
    left(btrim(p_workflow_key), 160),
    left(btrim(p_external_execution_id), 200),
    p_outbox_event_id,
    'succeeded',
    p_attempt,
    coalesce(p_started_at, now()),
    now(),
    null,
    null,
    coalesce(p_metrics, '{}'::jsonb)
  )
  on conflict (organization_id, workflow_key, external_execution_id)
  do update set
    outbox_event_id = excluded.outbox_event_id,
    status = 'succeeded',
    attempt = excluded.attempt,
    started_at = excluded.started_at,
    completed_at = now(),
    error_code = null,
    error_message = null,
    metrics = excluded.metrics
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function crm.claim_outbox_event(uuid, text) from public, anon, authenticated;
revoke all on function crm.log_automation_success(uuid, text, text, uuid, timestamptz, integer, jsonb) from public, anon, authenticated;
grant execute on function crm.claim_outbox_event(uuid, text) to service_role;
grant execute on function crm.log_automation_success(uuid, text, text, uuid, timestamptz, integer, jsonb) to service_role;
