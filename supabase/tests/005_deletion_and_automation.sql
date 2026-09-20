begin;
select plan(10);
set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

select throws_ok(
  $$select crm.execute_command('{
    "command_id":"50000000-0000-4000-a000-000000000001","idempotency_key":"test:delete:no-aal2",
    "command_name":"request_organization_deletion","organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001","target_type":"organization",
    "target_id":"aaaaaaaa-0000-0000-0000-000000000001","expected_version":1,"source":"crm",
    "occurred_at":"2026-08-05T12:00:00Z","payload":{"organization_name":"示例企业 A","verified_aal":"aal1"}
  }'::jsonb)$$,
  '42501', 'FORBIDDEN', 'deletion requires verified AAL2'
);

select throws_ok(
  $$select crm.execute_command('{
    "command_id":"50000000-0000-4000-a000-000000000010","idempotency_key":"test:delete:non-crm",
    "command_name":"request_organization_deletion","organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001","target_type":"organization",
    "target_id":"aaaaaaaa-0000-0000-0000-000000000001","expected_version":1,"source":"n8n",
    "occurred_at":"2026-08-05T12:00:30Z","payload":{"organization_name":"示例企业 A","verified_aal":"aal2"}
  }'::jsonb)$$,
  '42501', 'FORBIDDEN', 'non-CRM automation cannot impersonate an AAL2 deletion request'
);

select lives_ok(
  $$select crm.execute_command('{
    "command_id":"50000000-0000-4000-a000-000000000002","idempotency_key":"test:delete:aal2",
    "command_name":"request_organization_deletion","organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001","target_type":"organization",
    "target_id":"aaaaaaaa-0000-0000-0000-000000000001","expected_version":1,"source":"crm",
    "occurred_at":"2026-08-05T12:01:00Z","payload":{"organization_name":"示例企业 A","verified_aal":"aal2"}
  }'::jsonb)$$,
  'owner can request deletion with AAL2 and exact name'
);
select is((select status::text from public.organizations where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'pending_deletion', 'organization enters pending deletion');
select is((select count(*)::integer from public.organization_purge_jobs where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' and status = 'scheduled'), 1, 'purge job is scheduled');
select throws_ok(
  $$select crm.execute_command('{
    "command_id":"50000000-0000-4000-a000-000000000003","idempotency_key":"test:pending-write",
    "command_name":"accept_lead","organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000004","target_type":"lead",
    "target_id":"aa200000-0000-0000-0000-000000000001","expected_version":1,"source":"crm",
    "occurred_at":"2026-08-05T12:02:00Z","payload":{}
  }'::jsonb)$$,
  '55000', 'ORGANIZATION_INACTIVE', 'pending deletion stops business commands'
);
select throws_ok(
  $$select crm.execute_command('{
    "command_id":"50000000-0000-4000-a000-000000000011","idempotency_key":"test:delete:cancel:no-aal2",
    "command_name":"cancel_organization_deletion","organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001","target_type":"organization",
    "target_id":"aaaaaaaa-0000-0000-0000-000000000001","expected_version":2,"source":"crm",
    "occurred_at":"2026-08-05T12:02:30Z","payload":{"organization_name":"示例企业 A","verified_aal":"aal1"}
  }'::jsonb)$$,
  '42501', 'FORBIDDEN', 'cancelling deletion also requires owner AAL2 and exact name'
);
select lives_ok(
  $$select crm.execute_command('{
    "command_id":"50000000-0000-4000-a000-000000000004","idempotency_key":"test:delete:cancel",
    "command_name":"cancel_organization_deletion","organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001","target_type":"organization",
    "target_id":"aaaaaaaa-0000-0000-0000-000000000001","expected_version":2,"source":"crm",
    "occurred_at":"2026-08-05T12:03:00Z","payload":{"organization_name":"示例企业 A","verified_aal":"aal2"}
  }'::jsonb)$$,
  'owner can cancel pending deletion with AAL2 and exact name'
);
select is((select status::text from public.organizations where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'active', 'organization returns active');
select is((select status::text from public.organization_purge_jobs where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'cancelled', 'scheduled purge job is cancelled');

select * from finish();
rollback;
