begin;
select plan(16);
set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

select has_function('crm', 'claim_outbox_event', array['uuid', 'text'], 'controlled Outbox claim RPC exists');
select has_function(
  'crm',
  'log_automation_success',
  array['uuid', 'text', 'text', 'uuid', 'timestamp with time zone', 'integer', 'jsonb'],
  'automation success RPC exists'
);

select lives_ok(
  $$insert into public.outbox_events (
    id, organization_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    '70000000-0000-4000-a000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'lead',
    'aa200000-0000-0000-0000-000000000001',
    'lead.intake.accepted',
    '{"lead_id":"aa200000-0000-0000-0000-000000000001"}'::jsonb
  )$$,
  'controlled test event is created'
);

select is(
  (crm.claim_outbox_event('70000000-0000-4000-a000-000000000001', 'pgtest:controlled')).status::text,
  'processing',
  'controlled claim returns processing event'
);
select is(
  (select attempts from public.outbox_events where id = '70000000-0000-4000-a000-000000000001'),
  1,
  'controlled claim increments attempts once'
);
select is(
  (crm.claim_outbox_event('70000000-0000-4000-a000-000000000001', 'pgtest:controlled')).locked_by,
  'pgtest:controlled',
  'same worker can repeat controlled claim idempotently'
);
select is(
  (select attempts from public.outbox_events where id = '70000000-0000-4000-a000-000000000001'),
  1,
  'idempotent repeat does not increment attempts'
);
select throws_ok(
  $$select crm.claim_outbox_event('70000000-0000-4000-a000-000000000001', 'pgtest:other')$$,
  '55000',
  'OUTBOX_EVENT_NOT_CLAIMABLE',
  'another worker cannot steal a live controlled claim'
);
select lives_ok(
  $$select crm.complete_outbox_event('70000000-0000-4000-a000-000000000001', 'pgtest:controlled')$$,
  'controlled event can use the standard completion RPC'
);
select is(
  (select status::text from public.outbox_events where id = '70000000-0000-4000-a000-000000000001'),
  'completed',
  'completed controlled event is persisted'
);
select lives_ok(
  $$select crm.log_automation_success(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'CN-02 controlled test',
    'pgtest-controlled-1',
    '70000000-0000-4000-a000-000000000001',
    '2026-08-06T12:00:00Z',
    1,
    '{"mode":"controlled_demo"}'::jsonb
  )$$,
  'successful automation run is recorded'
);
select is(
  (select status::text from public.automation_runs where external_execution_id = 'pgtest-controlled-1'),
  'succeeded',
  'automation run has succeeded status'
);
select lives_ok(
  $$select crm.log_automation_success(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'CN-02 controlled test',
    'pgtest-controlled-1',
    '70000000-0000-4000-a000-000000000001',
    '2026-08-06T12:00:00Z',
    1,
    '{"mode":"controlled_demo","tokens":12}'::jsonb
  )$$,
  'successful automation log is idempotently updated'
);
select is(
  (select count(*)::integer from public.automation_runs where external_execution_id = 'pgtest-controlled-1'),
  1,
  'idempotent success logging keeps one row'
);
select is(
  (select (metrics ->> 'tokens')::integer from public.automation_runs where external_execution_id = 'pgtest-controlled-1'),
  12,
  'idempotent success logging refreshes safe metrics'
);
select is(
  (select outbox_event_id from public.automation_runs where external_execution_id = 'pgtest-controlled-1'),
  '70000000-0000-4000-a000-000000000001'::uuid,
  'automation run remains linked to its Outbox event'
);

select * from finish();
rollback;
