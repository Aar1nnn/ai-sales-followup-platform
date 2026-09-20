begin;
select plan(11);

set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

create or replace function pg_temp.manual_intake(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_source_event_id text,
  p_name text
)
returns jsonb
language plpgsql
as $$
declare
  v_connection_id uuid;
  v_raw jsonb;
  v_normalized jsonb;
begin
  v_connection_id := (crm.ensure_authenticated_manual_source(p_organization_id) ->> 'connection_id')::uuid;
  v_raw := jsonb_build_object(
    'organization_id', p_organization_id,
    'source_event_id', p_source_event_id,
    'contact', jsonb_build_object(
      'name', p_name,
      'phone', '18800009999',
      'email', 'manual-intake@example.test',
      'wechat', null,
      'company', '手工录入测试企业'
    ),
    'lead', jsonb_build_object(
      'need', '验证登录用户手工创建线索',
      'budget', 100000,
      'urgency', 'high',
      'notes', 'pgTAP transaction-only fixture'
    ),
    'tracking', '{}'::jsonb,
    'consent', '{"contact_permission":true}'::jsonb,
    'metadata', '{"intake_mode":"authenticated_manual"}'::jsonb
  );
  v_normalized := v_raw || jsonb_build_object(
    'schema_version', '1.0',
    'source', 'internal_manual',
    'source_connection_id', v_connection_id,
    'received_at', '2026-08-06T04:00:00Z'
  );
  return crm.intake_authenticated_manual_lead(
    v_connection_id,
    p_actor_user_id,
    p_source_event_id,
    '2026-08-06T04:00:00Z',
    v_raw,
    v_normalized,
    encode(extensions.digest(convert_to(v_raw::text, 'UTF8'), 'sha256'), 'hex')
  );
end;
$$;

select is(
  (
    select status::text
    from public.lead_source_connections
    where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and provider = 'internal_manual'
      and external_source_id = 'crm-manual-entry-v1'
  ),
  'active',
  'authenticated manual source is active'
);

select ok(
  (
    select secret_ref is null and settings ->> 'authenticated_manual' = 'true'
    from public.lead_source_connections
    where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and external_source_id = 'crm-manual-entry-v1'
  ),
  'authenticated manual source does not require a browser secret'
);

select lives_ok(
  $$select pg_temp.manual_intake(
    '10000000-0000-0000-0000-000000000004',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'manual-pgtap-sales-0001',
    '手工录入 Sales 客户'
  )$$,
  'active sales member can create a manual lead'
);

select is(
  (
    select lead.owner_member_id::text
    from public.leads lead
    join public.inbound_events event on event.lead_id = lead.id
    where event.source_event_id = 'manual-pgtap-sales-0001'
  ),
  'aa000000-0000-0000-0000-000000000004',
  'sales-created lead is assigned to the sales member'
);

select is(
  (
    select lead.status::text
    from public.leads lead
    join public.inbound_events event on event.lead_id = lead.id
    where event.source_event_id = 'manual-pgtap-sales-0001'
  ),
  'working',
  'sales-created lead enters working state'
);

select ok(
  (
    select contact.identity_pending and contact.phone_verified_at is null and contact.email_verified_at is null
    from public.contacts contact
    join public.leads lead on lead.contact_id = contact.id
    join public.inbound_events event on event.lead_id = lead.id
    where event.source_event_id = 'manual-pgtap-sales-0001'
  ),
  'manually typed contact identity remains unverified'
);

select is(
  (
    select count(*)::integer
    from public.outbox_events outbox
    join public.inbound_events event on event.lead_id = outbox.aggregate_id
    where event.source_event_id = 'manual-pgtap-sales-0001'
      and outbox.event_type = 'lead.intake.accepted'
  ),
  1,
  'manual intake emits one lead intake outbox event'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs audit
    join public.inbound_events event on event.lead_id = audit.target_id
    where event.source_event_id = 'manual-pgtap-sales-0001'
      and audit.action = 'create_manual_lead'
      and audit.actor_member_id = 'aa000000-0000-0000-0000-000000000004'
  ),
  1,
  'authenticated manual intake records its real actor without customer PII'
);

select is(
  pg_temp.manual_intake(
    '10000000-0000-0000-0000-000000000004',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'manual-pgtap-sales-0001',
    '手工录入 Sales 客户'
  ) ->> 'status',
  'duplicate',
  'identical retry uses inbound idempotency'
);

select is(
  pg_temp.manual_intake(
    '10000000-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'manual-pgtap-owner-0001',
    '手工录入 Owner 客户'
  ) ->> 'assignment_status',
  'unassigned',
  'owner-created lead enters the unassigned pool'
);

select throws_ok(
  $$select pg_temp.manual_intake(
    '20000000-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'manual-pgtap-cross-org-0001',
    '跨组织客户'
  )$$,
  '42501',
  'FORBIDDEN',
  'member from another organization is rejected'
);

select * from finish();
rollback;
