begin;
select plan(11);

set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

select lives_ok(
  $$select crm.execute_command('{
    "command_id":"30000000-0000-4000-a000-000000000001",
    "idempotency_key":"test:acknowledge:1",
    "command_name":"acknowledge_lead",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000004",
    "target_type":"lead",
    "target_id":"aa200000-0000-0000-0000-000000000001",
    "expected_version":1,
    "source":"crm",
    "occurred_at":"2026-08-05T12:00:00Z",
    "payload":{}
  }'::jsonb)$$,
  'acknowledge command succeeds'
);
select is((select status::text from public.leads where id = 'aa200000-0000-0000-0000-000000000001'), 'working', 'lead state is retained');
select isnt((select acknowledged_at from public.leads where id = 'aa200000-0000-0000-0000-000000000001'), null, 'acknowledged timestamp is recorded');
select is((select count(*)::integer from public.command_executions where idempotency_key = 'test:acknowledge:1'), 1, 'one command execution is written');
select is((select count(*)::integer from public.activities where metadata ->> 'command_id' = '30000000-0000-4000-a000-000000000001'), 1, 'activity is written in transaction');
select is((select count(*)::integer from public.audit_logs where metadata ->> 'command_id' = '30000000-0000-4000-a000-000000000001'), 1, 'audit is written in transaction');
select is((select count(*)::integer from public.outbox_events where payload ->> 'command_id' = '30000000-0000-4000-a000-000000000001'), 1, 'outbox is written in transaction');

select lives_ok(
  $$select crm.execute_command('{
    "command_id":"30000000-0000-4000-a000-000000000001",
    "idempotency_key":"test:acknowledge:1",
    "command_name":"acknowledge_lead",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000004",
    "target_type":"lead",
    "target_id":"aa200000-0000-0000-0000-000000000001",
    "expected_version":1,
    "source":"crm",
    "occurred_at":"2026-08-05T12:00:00Z",
    "payload":{}
  }'::jsonb)$$,
  'identical retry returns stored response'
);
select is((select count(*)::integer from public.command_executions where idempotency_key = 'test:acknowledge:1'), 1, 'identical retry does not duplicate command');

select throws_ok(
  $$select crm.execute_command('{
    "command_id":"30000000-0000-4000-a000-000000000002",
    "idempotency_key":"test:version-conflict:1",
    "command_name":"acknowledge_lead",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000004",
    "target_type":"lead",
    "target_id":"aa200000-0000-0000-0000-000000000001",
    "expected_version":1,
    "source":"crm",
    "occurred_at":"2026-08-05T12:01:00Z",
    "payload":{}
  }'::jsonb)$$,
  'P0001', 'VERSION_CONFLICT', 'stale expected version is rejected without a retryable database state'
);
select is((select count(*)::integer from public.command_executions where idempotency_key = 'test:version-conflict:1'), 0, 'failed command rolls back execution row');

select * from finish();
rollback;
