begin;
select plan(24);

set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

select has_table('public', 'organization_invitations', 'organization invitations table exists');
select has_function('crm', 'execute_admin_command', array['jsonb'], 'admin command RPC exists');

select is(
  crm.prepare_member_invitation(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'new.sales@example.test', 'New Sales', 'Sales', 'sales', true, 'test:invite:prepare:1'
  ) ->> 'status',
  'processing',
  'owner can prepare a member invitation'
);
select is(
  (select count(*)::integer from public.organization_invitations
    where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and email = 'new.sales@example.test'),
  1,
  'prepared invitation is persisted'
);

select throws_ok(
  $$select crm.prepare_member_invitation(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'new.admin@example.test', 'New Admin', null, 'admin', true, 'test:invite:admin:1'
  )$$,
  '42501', 'FORBIDDEN', 'admin cannot grant the admin role'
);

insert into public.organization_invitations (
  id, organization_id, email, display_name, role, status, auth_user_id,
  invited_by_member_id, idempotency_key
) values (
  '81000000-0000-4000-a000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'sales.b1@example.test', 'Provisioned Sales', 'sales', 'processing',
  '20000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001',
  'test:invite:provision:1'
);

select lives_ok(
  $$select crm.execute_admin_command('{
    "command_id":"81000000-0000-4000-a000-000000000001",
    "idempotency_key":"member-provision:81000000-0000-4000-a000-000000000001",
    "command_name":"provision_organization_member",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"organization_invitation",
    "target_id":"81000000-0000-4000-a000-000000000001",
    "expected_version":1,
    "source":"system",
    "occurred_at":"2026-08-05T12:00:00Z",
    "payload":{"auth_user_id":"20000000-0000-0000-0000-000000000001"}
  }'::jsonb)$$,
  'provision command creates an active member'
);
select is(
  (select status::text from public.organization_members
    where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and user_id = '20000000-0000-0000-0000-000000000001'),
  'active',
  'provisioned member is active'
);
select is(
  (select status from public.organization_invitations where id = '81000000-0000-4000-a000-000000000001'),
  'provisioned',
  'invitation records successful provisioning'
);
select is(
  crm.prepare_member_invitation(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'sales.b1@example.test', 'Provisioned Sales', null, 'sales', true, 'test:invite:provision:1'
  ) ->> 'status',
  'provisioned',
  'identical invitation retry returns the provisioned result'
);

select lives_ok(
  $$select crm.execute_admin_command('{
    "command_id":"82000000-0000-4000-a000-000000000001",
    "idempotency_key":"test:member:update:1",
    "command_name":"update_organization_member",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"organization_member",
    "target_id":"aa000000-0000-0000-0000-000000000005",
    "expected_version":1,
    "source":"crm",
    "occurred_at":"2026-08-05T12:01:00Z",
    "payload":{"role":"sales","accepts_assignments":true,"is_away":false,"daily_lead_limit":12}
  }'::jsonb)$$,
  'owner can update a sales member'
);
select is(
  (select daily_lead_limit from public.organization_members where id = 'aa000000-0000-0000-0000-000000000005'),
  12,
  'member assignment limit is updated'
);

select throws_ok(
  $$select crm.execute_admin_command('{
    "command_id":"82000000-0000-4000-a000-000000000002",
    "idempotency_key":"test:member:admin-target:1",
    "command_name":"update_organization_member",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000002",
    "target_type":"organization_member",
    "target_id":"aa000000-0000-0000-0000-000000000002",
    "source":"crm","occurred_at":"2026-08-05T12:02:00Z",
    "payload":{"role":"manager"}
  }'::jsonb)$$,
  '42501', 'FORBIDDEN', 'admin cannot manage another admin'
);

select throws_ok(
  $$select crm.execute_admin_command('{
    "command_id":"82000000-0000-4000-a000-000000000003",
    "idempotency_key":"test:member:deactivate:no-replacement",
    "command_name":"deactivate_organization_member",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"organization_member",
    "target_id":"aa000000-0000-0000-0000-000000000004",
    "source":"crm","occurred_at":"2026-08-05T12:03:00Z","payload":{}
  }'::jsonb)$$,
  '22023', 'REPLACEMENT_REQUIRED', 'open workload requires an eligible replacement'
);

select lives_ok(
  $$select crm.execute_admin_command('{
    "command_id":"82000000-0000-4000-a000-000000000004",
    "idempotency_key":"test:member:deactivate:replacement",
    "command_name":"deactivate_organization_member",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"organization_member",
    "target_id":"aa000000-0000-0000-0000-000000000004",
    "source":"crm","occurred_at":"2026-08-05T12:04:00Z",
    "payload":{"replacement_member_id":"aa000000-0000-0000-0000-000000000005"}
  }'::jsonb)$$,
  'member deactivation transfers open workload atomically'
);
select is(
  (select status::text from public.organization_members where id = 'aa000000-0000-0000-0000-000000000004'),
  'inactive',
  'deactivated member becomes inactive'
);
select is(
  (select owner_member_id from public.leads where id = 'aa200000-0000-0000-0000-000000000001'),
  'aa000000-0000-0000-0000-000000000005'::uuid,
  'open lead is transferred to replacement'
);
select is(
  (select count(*)::integer from public.assignment_history
    where lead_id = 'aa200000-0000-0000-0000-000000000001'
      and reason = 'reassignment'),
  1,
  'lead reassignment is recorded'
);

insert into public.outbox_events (
  id, organization_id, aggregate_type, aggregate_id, event_type, status,
  attempts, max_attempts, last_error_code, last_error_message
) values (
  '83000000-0000-4000-a000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'lead', 'aa200000-0000-0000-0000-000000000001', 'test.dead-letter', 'dead_letter',
  10, 10, 'TRANSIENT_PROVIDER_ERROR', 'test failure'
);
select lives_ok(
  $$select crm.execute_admin_command('{
    "command_id":"83000000-0000-4000-a000-000000000002",
    "idempotency_key":"test:outbox:retry:1","command_name":"retry_outbox_event",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"outbox_event","target_id":"83000000-0000-4000-a000-000000000001",
    "expected_version":1,"source":"crm","occurred_at":"2026-08-05T12:05:00Z","payload":{}
  }'::jsonb)$$,
  'owner can retry a dead-letter event'
);
select is(
  (select status::text || ':' || attempts::text from public.outbox_events where id = '83000000-0000-4000-a000-000000000001'),
  'pending:0',
  'retry resets dead-letter event state'
);

select lives_ok(
  $$select crm.execute_admin_command('{
    "command_id":"84000000-0000-4000-a000-000000000001",
    "idempotency_key":"test:feishu:verify:1","command_name":"verify_member_channel_identity",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"organization_member","target_id":"aa000000-0000-0000-0000-000000000005",
    "source":"system","occurred_at":"2026-08-05T12:06:00Z",
    "payload":{"feishu_open_id":"ou_verified_sales_a2","feishu_user_id":"u_sales_a2"}
  }'::jsonb)$$,
  'provider-validated Feishu identity can be persisted'
);
select is(
  (select status from public.organization_member_channel_identities
    where member_id = 'aa000000-0000-0000-0000-000000000005' and provider = 'feishu_internal'),
  'verified',
  'Feishu mapping is marked verified'
);

select throws_ok(
  $$select crm.execute_admin_command('{
    "command_id":"84000000-0000-4000-a000-000000000002",
    "idempotency_key":"test:feishu:duplicate:1","command_name":"verify_member_channel_identity",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"organization_member","target_id":"aa000000-0000-0000-0000-000000000003",
    "source":"system","occurred_at":"2026-08-05T12:06:30Z",
    "payload":{"feishu_open_id":"ou_verified_sales_a2","feishu_user_id":"u_duplicate"}
  }'::jsonb)$$,
  '23505', null, 'one verified Feishu open ID cannot map to two members'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select is(
  (select count(*)::integer from public.organization_member_channel_identities
    where member_id = 'aa000000-0000-0000-0000-000000000005'),
  0,
  'manager cannot read another member provider identity'
);
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select is(
  (select count(*)::integer from public.organization_invitations
    where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and idempotency_key in ('test:invite:prepare:1', 'test:invite:provision:1')),
  2,
  'owner can read organization invitations'
);

select * from finish();
rollback;
