create unique index organizations_one_active_primary_idx
  on public.organizations ((is_primary))
  where is_primary and status in ('active', 'suspended', 'pending_deletion', 'purging', 'purge_failed');

create unique index organization_members_one_active_owner_idx
  on public.organization_members (organization_id)
  where role = 'owner' and status = 'active';

create unique index pipeline_stages_one_default_idx
  on public.pipeline_stages (organization_id)
  where is_default;

create unique index scoring_profiles_one_active_idx
  on public.organization_scoring_profiles (organization_id)
  where status = 'active';

create unique index contacts_verified_phone_idx
  on public.contacts (organization_id, lower(btrim(phone)))
  where phone is not null and phone_verified_at is not null and status <> 'merged';

create unique index contacts_verified_email_idx
  on public.contacts (organization_id, lower(btrim(email)))
  where email is not null and email_verified_at is not null and status <> 'merged';

create unique index opportunities_one_primary_per_lead_idx
  on public.opportunities (organization_id, lead_id)
  where is_primary;

create index organization_members_assignment_idx
  on public.organization_members (organization_id, status, role, accepts_assignments, is_away, last_assigned_at);
create index contacts_owner_idx on public.contacts (organization_id, owner_member_id, status);
create index leads_owner_status_idx on public.leads (organization_id, owner_member_id, status, created_at desc);
create index leads_contact_created_idx on public.leads (organization_id, contact_id, created_at desc);
create index opportunities_owner_status_idx on public.opportunities (organization_id, owner_member_id, status);
create index activities_lead_time_idx on public.activities (organization_id, lead_id, occurred_at desc);
create index activities_contact_time_idx on public.activities (organization_id, contact_id, occurred_at desc);
create index follow_up_tasks_due_idx on public.follow_up_tasks (organization_id, status, due_at)
  where status in ('open', 'snoozed');
create index follow_up_tasks_assignee_idx on public.follow_up_tasks (organization_id, assignee_member_id, status, due_at);
create index lead_scores_latest_idx on public.lead_scores (organization_id, lead_id, scored_at desc);
create index message_drafts_owner_idx on public.message_drafts (organization_id, owner_member_id, status, created_at desc);
create index messages_lead_time_idx on public.messages (organization_id, lead_id, sent_at desc);
create index assignment_history_daily_idx on public.assignment_history (organization_id, to_member_id, created_at desc);
create index inbound_events_retention_idx on public.inbound_events (created_at) where status in ('processed', 'failed', 'expired');
create index delivery_events_retention_idx on public.delivery_events (created_at);
create index command_executions_retention_idx on public.command_executions (created_at, status);
create index audit_logs_retention_idx on public.audit_logs (created_at);
create index outbox_claim_idx on public.outbox_events (available_at, created_at)
  where status = 'pending';
create unique index outbox_deduplication_idx on public.outbox_events (organization_id, deduplication_key)
  where deduplication_key is not null;
create index outbox_processing_idx on public.outbox_events (locked_at)
  where status = 'processing';
create index purge_jobs_due_idx on public.organization_purge_jobs (scheduled_at)
  where status in ('scheduled', 'failed');
