create or replace function crm.ensure_authenticated_manual_source(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.lead_source_connections%rowtype;
  v_created_by_member_id uuid;
begin
  perform crm.require_service_role();

  if not exists (
    select 1 from public.organizations
    where id = p_organization_id and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE';
  end if;

  select * into v_connection
  from public.lead_source_connections
  where organization_id = p_organization_id
    and provider = 'internal_manual'
    and external_source_id = 'crm-manual-entry-v1'
  for update;

  if not found then
    select id into v_created_by_member_id
    from public.organization_members
    where organization_id = p_organization_id
      and status = 'active'
      and role in ('owner', 'admin')
    order by case role when 'owner' then 0 else 1 end, created_at
    limit 1;

    insert into public.lead_source_connections (
      organization_id,
      provider,
      name,
      status,
      external_source_id,
      mapping,
      settings,
      rate_limit_per_minute,
      max_payload_bytes,
      created_by_member_id,
      validated_at
    ) values (
      p_organization_id,
      'internal_manual',
      'CRM 手工录入',
      'active',
      'crm-manual-entry-v1',
      '{}'::jsonb,
      '{"authenticated_manual":true,"verified_identity_fields":[]}'::jsonb,
      120,
      32768,
      v_created_by_member_id,
      now()
    )
    on conflict (organization_id, provider, external_source_id) do update set
      name = excluded.name,
      status = 'active',
      mapping = excluded.mapping,
      settings = excluded.settings,
      rate_limit_per_minute = excluded.rate_limit_per_minute,
      max_payload_bytes = excluded.max_payload_bytes,
      validated_at = now()
    returning * into v_connection;
  elsif v_connection.status <> 'active'
    or v_connection.settings ->> 'authenticated_manual' <> 'true'
  then
    update public.lead_source_connections set
      name = 'CRM 手工录入',
      status = 'active',
      mapping = '{}'::jsonb,
      settings = '{"authenticated_manual":true,"verified_identity_fields":[]}'::jsonb,
      rate_limit_per_minute = 120,
      max_payload_bytes = 32768,
      validated_at = now()
    where id = v_connection.id
    returning * into v_connection;
  end if;

  return jsonb_build_object(
    'connection_id', v_connection.id,
    'public_id', v_connection.public_id,
    'status', v_connection.status
  );
end;
$$;

create or replace function crm.intake_authenticated_manual_lead(
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_source_event_id text,
  p_received_at timestamptz,
  p_raw_payload jsonb,
  p_normalized_payload jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.lead_source_connections%rowtype;
  v_actor public.organization_members%rowtype;
  v_result jsonb;
  v_lead_id uuid;
  v_owner_member_id uuid;
begin
  perform crm.require_service_role();

  select * into v_connection
  from public.lead_source_connections
  where id = p_connection_id
    and provider = 'internal_manual'
    and external_source_id = 'crm-manual-entry-v1'
    and status = 'active'
    and settings ->> 'authenticated_manual' = 'true'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONNECTION_INVALID';
  end if;

  select * into v_actor
  from public.organization_members
  where organization_id = v_connection.organization_id
    and user_id = p_actor_user_id
    and status = 'active'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  v_result := crm.intake_lead(
    p_connection_id,
    p_source_event_id,
    p_received_at,
    p_raw_payload,
    p_normalized_payload,
    p_payload_sha256
  );
  v_lead_id := (v_result ->> 'lead_id')::uuid;

  if v_result ->> 'status' = 'accepted' and v_actor.role = 'sales' then
    perform crm.execute_command(jsonb_build_object(
      'command_id', extensions.gen_random_uuid(),
      'idempotency_key', 'manual-intake-accept:' || p_source_event_id,
      'command_name', 'accept_lead',
      'organization_id', v_connection.organization_id,
      'actor_user_id', p_actor_user_id,
      'target_type', 'lead',
      'target_id', v_lead_id,
      'expected_version', null,
      'source', 'crm',
      'occurred_at', coalesce(p_received_at, now()),
      'payload', '{}'::jsonb
    ));
  end if;

  select owner_member_id into v_owner_member_id
  from public.leads
  where organization_id = v_connection.organization_id and id = v_lead_id;

  if v_result ->> 'status' = 'accepted' then
    insert into public.audit_logs (
      organization_id,
      actor_user_id,
      actor_member_id,
      action,
      target_type,
      target_id,
      source,
      after_state,
      metadata
    ) values (
      v_connection.organization_id,
      p_actor_user_id,
      v_actor.id,
      'create_manual_lead',
      'lead',
      v_lead_id,
      'crm',
      jsonb_build_object(
        'lead_id', v_lead_id,
        'owner_member_id', v_owner_member_id,
        'assignment_status', case when v_owner_member_id is null then 'unassigned' else 'assigned' end
      ),
      jsonb_build_object(
        'inbound_event_id', v_result ->> 'inbound_event_id',
        'source_event_id', p_source_event_id,
        'intake_mode', 'authenticated_manual'
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'owner_member_id', v_owner_member_id,
    'assignment_status', case when v_owner_member_id is null then 'unassigned' else 'assigned' end
  );
end;
$$;

revoke all on function crm.ensure_authenticated_manual_source(uuid) from public, anon, authenticated;
revoke all on function crm.intake_authenticated_manual_lead(uuid, uuid, text, timestamptz, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function crm.ensure_authenticated_manual_source(uuid) to service_role;
grant execute on function crm.intake_authenticated_manual_lead(uuid, uuid, text, timestamptz, jsonb, jsonb, text) to service_role;

insert into public.lead_source_connections (
  organization_id,
  provider,
  name,
  status,
  external_source_id,
  mapping,
  settings,
  rate_limit_per_minute,
  max_payload_bytes,
  created_by_member_id,
  validated_at
)
select
  organization.id,
  'internal_manual',
  'CRM 手工录入',
  'active',
  'crm-manual-entry-v1',
  '{}'::jsonb,
  '{"authenticated_manual":true,"verified_identity_fields":[]}'::jsonb,
  120,
  32768,
  creator.id,
  now()
from public.organizations organization
left join lateral (
  select member.id
  from public.organization_members member
  where member.organization_id = organization.id
    and member.status = 'active'
    and member.role in ('owner', 'admin')
  order by case member.role when 'owner' then 0 else 1 end, member.created_at
  limit 1
) creator on true
where organization.status = 'active'
on conflict (organization_id, provider, external_source_id) do update set
  name = excluded.name,
  status = 'active',
  mapping = excluded.mapping,
  settings = excluded.settings,
  rate_limit_per_minute = excluded.rate_limit_per_minute,
  max_payload_bytes = excluded.max_payload_bytes,
  validated_at = now();
