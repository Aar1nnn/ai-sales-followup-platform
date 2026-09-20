begin;
select plan(13);
set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

create temporary table manual_test_ids (draft_id uuid, task_id uuid);
insert into manual_test_ids (draft_id)
select (crm.execute_command('{
  "command_id":"40000000-0000-4000-a000-000000000001",
  "idempotency_key":"test:draft:create:1",
  "command_name":"create_message_draft",
  "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
  "actor_user_id":"10000000-0000-0000-0000-000000000004",
  "target_type":"lead",
  "target_id":"aa200000-0000-0000-0000-000000000001",
  "expected_version":1,
  "source":"crm",
  "occurred_at":"2026-08-05T12:00:00Z",
  "payload":{"content":"您好，这是待确认的跟进草稿。"}
}'::jsonb) #>> '{result,message_draft_id}')::uuid;

with inserted_task as (
  insert into public.follow_up_tasks (
    organization_id, contact_id, lead_id, assignee_member_id, created_by_member_id, title, due_at
  ) values (
    'aaaaaaaa-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001',
    'aa200000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000004',
    'aa000000-0000-0000-0000-000000000004', '当前跟进', now() + interval '1 hour'
  ) returning id
)
update manual_test_ids set task_id = inserted_task.id from inserted_task;

select is((select count(*)::integer from public.message_drafts where id = (select draft_id from manual_test_ids)), 1, 'draft is created through command');

select lives_ok(format($command$
  select crm.execute_command(%L::jsonb)
$command$, jsonb_build_object(
  'command_id', '40000000-0000-4000-a000-000000000010',
  'idempotency_key', 'test:draft:regenerate:1',
  'command_name', 'regenerate_message_draft',
  'organization_id', 'aaaaaaaa-0000-0000-0000-000000000001',
  'actor_user_id', '10000000-0000-0000-0000-000000000004',
  'target_type', 'message_draft',
  'target_id', (select draft_id from manual_test_ids),
  'expected_version', 1,
  'source', 'crm',
  'occurred_at', '2026-08-05T12:00:30Z',
  'payload', '{}'::jsonb
)::text), 'regenerate request succeeds without accepting generated content from browser');
select is((select version::integer from public.message_drafts where id = (select draft_id from manual_test_ids)), 2, 'regenerate request advances optimistic version');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select draft_id from manual_test_ids) and event_type = 'command.regenerate_message_draft.succeeded'), 1, 'regenerate request emits automation outbox event');

select lives_ok(format($command$
  select crm.execute_command(%L::jsonb)
$command$, jsonb_build_object(
  'command_id', '40000000-0000-4000-a000-000000000002',
  'idempotency_key', 'test:manual:sent:1',
  'command_name', 'mark_manual_message_sent',
  'organization_id', 'aaaaaaaa-0000-0000-0000-000000000001',
  'actor_user_id', '10000000-0000-0000-0000-000000000004',
  'target_type', 'message_draft',
  'target_id', (select draft_id from manual_test_ids),
  'expected_version', 2,
  'source', 'crm',
  'occurred_at', '2026-08-05T12:01:00Z',
  'payload', jsonb_build_object(
    'actual_channel', 'personal_wechat', 'content', '您好，这是实际发送内容。', 'outcome', 'interested',
    'notes', '客户希望明天继续沟通', 'next_follow_up_at', '2026-08-06T10:00:00Z',
    'task_id', (select task_id from manual_test_ids)
  )
)::text), 'manual sent command succeeds');

select is((select status::text from public.message_drafts where id = (select draft_id from manual_test_ids)), 'sent', 'draft becomes sent');
select is((select count(*)::integer from public.messages where message_draft_id = (select draft_id from manual_test_ids) and provider = 'manual' and actual_channel = 'personal_wechat'), 1, 'message records actual manual channel');
select is((select content from public.messages where message_draft_id = (select draft_id from manual_test_ids)), '您好，这是实际发送内容。', 'message stores actual content snapshot');
select is((select outcome::text from public.messages where message_draft_id = (select draft_id from manual_test_ids)), 'interested', 'message records outcome');
select is((select status::text from public.follow_up_tasks where id = (select task_id from manual_test_ids)), 'completed', 'current task is completed');
select is((select count(*)::integer from public.follow_up_tasks where lead_id = 'aa200000-0000-0000-0000-000000000001' and status = 'open' and title = '客户消息后续跟进'), 1, 'next task is created');
select is((select count(*)::integer from public.activities where activity_type = 'mark_manual_message_sent'), 1, 'manual send writes activity');
select is((select count(*)::integer from public.outbox_events where event_type = 'command.mark_manual_message_sent.succeeded'), 1, 'manual send writes outbox event');

select * from finish();
rollback;
