alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.opportunities enable row level security;
alter table public.activities enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.organization_scoring_profiles enable row level security;
alter table public.lead_scores enable row level security;
alter table public.score_history enable row level security;
alter table public.channel_connections enable row level security;
alter table public.contact_channel_identities enable row level security;
alter table public.organization_member_channel_identities enable row level security;
alter table public.message_drafts enable row level security;
alter table public.messages enable row level security;
alter table public.delivery_events enable row level security;
alter table public.organization_assignment_settings enable row level security;
alter table public.assignment_history enable row level security;
alter table public.lead_source_connections enable row level security;
alter table public.inbound_events enable row level security;
alter table public.command_executions enable row level security;
alter table public.outbox_events enable row level security;
alter table public.automation_runs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.organization_purge_jobs enable row level security;
alter table public.organization_tombstones enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_active_org_member(id));
create policy organizations_insert on public.organizations for insert to authenticated with check (false);
create policy organizations_update on public.organizations for update to authenticated using (false) with check (false);
create policy organizations_delete on public.organizations for delete to authenticated using (false);

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.status = 'active' and theirs.user_id = profiles.id and theirs.status = 'active'
  ));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_delete on public.profiles for delete to authenticated using (false);

create policy organization_members_select on public.organization_members for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy organization_members_insert on public.organization_members for insert to authenticated with check (false);
create policy organization_members_update on public.organization_members for update to authenticated using (false) with check (false);
create policy organization_members_delete on public.organization_members for delete to authenticated using (false);

create policy accounts_select on public.accounts for select to authenticated
  using (public.can_access_account(organization_id, id));
create policy accounts_insert on public.accounts for insert to authenticated with check (false);
create policy accounts_update on public.accounts for update to authenticated using (false) with check (false);
create policy accounts_delete on public.accounts for delete to authenticated using (false);

create policy contacts_select on public.contacts for select to authenticated
  using (public.can_access_assigned_record(organization_id, owner_member_id));
create policy contacts_insert on public.contacts for insert to authenticated with check (false);
create policy contacts_update on public.contacts for update to authenticated using (false) with check (false);
create policy contacts_delete on public.contacts for delete to authenticated using (false);

create policy leads_select on public.leads for select to authenticated
  using (public.can_access_assigned_record(organization_id, owner_member_id));
create policy leads_insert on public.leads for insert to authenticated with check (false);
create policy leads_update on public.leads for update to authenticated using (false) with check (false);
create policy leads_delete on public.leads for delete to authenticated using (false);

create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated with check (false);
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated using (false) with check (false);
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated using (false);

create policy opportunities_select on public.opportunities for select to authenticated
  using (public.can_access_assigned_record(organization_id, owner_member_id));
create policy opportunities_insert on public.opportunities for insert to authenticated with check (false);
create policy opportunities_update on public.opportunities for update to authenticated using (false) with check (false);
create policy opportunities_delete on public.opportunities for delete to authenticated using (false);

create policy activities_select on public.activities for select to authenticated
  using (public.can_manage_sales(organization_id)
    or owner_member_id = public.current_organization_member_id(organization_id)
    or actor_member_id = public.current_organization_member_id(organization_id)
    or (lead_id is not null and public.can_access_lead(organization_id, lead_id))
    or (contact_id is not null and public.can_access_contact(organization_id, contact_id))
    or (opportunity_id is not null and public.can_access_opportunity(organization_id, opportunity_id)));
create policy activities_insert on public.activities for insert to authenticated with check (false);
create policy activities_update on public.activities for update to authenticated using (false) with check (false);
create policy activities_delete on public.activities for delete to authenticated using (false);

create policy follow_up_tasks_select on public.follow_up_tasks for select to authenticated
  using (public.can_manage_sales(organization_id)
    or assignee_member_id = public.current_organization_member_id(organization_id));
create policy follow_up_tasks_insert on public.follow_up_tasks for insert to authenticated with check (false);
create policy follow_up_tasks_update on public.follow_up_tasks for update to authenticated using (false) with check (false);
create policy follow_up_tasks_delete on public.follow_up_tasks for delete to authenticated using (false);

create policy organization_scoring_profiles_select on public.organization_scoring_profiles for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy organization_scoring_profiles_insert on public.organization_scoring_profiles for insert to authenticated with check (false);
create policy organization_scoring_profiles_update on public.organization_scoring_profiles for update to authenticated using (false) with check (false);
create policy organization_scoring_profiles_delete on public.organization_scoring_profiles for delete to authenticated using (false);

create policy lead_scores_select on public.lead_scores for select to authenticated
  using (public.can_access_lead(organization_id, lead_id));
create policy lead_scores_insert on public.lead_scores for insert to authenticated with check (false);
create policy lead_scores_update on public.lead_scores for update to authenticated using (false) with check (false);
create policy lead_scores_delete on public.lead_scores for delete to authenticated using (false);

create policy score_history_select on public.score_history for select to authenticated
  using (public.can_access_lead(organization_id, lead_id));
create policy score_history_insert on public.score_history for insert to authenticated with check (false);
create policy score_history_update on public.score_history for update to authenticated using (false) with check (false);
create policy score_history_delete on public.score_history for delete to authenticated using (false);

create policy channel_connections_select on public.channel_connections for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy channel_connections_insert on public.channel_connections for insert to authenticated with check (false);
create policy channel_connections_update on public.channel_connections for update to authenticated using (false) with check (false);
create policy channel_connections_delete on public.channel_connections for delete to authenticated using (false);

create policy contact_channel_identities_select on public.contact_channel_identities for select to authenticated
  using (public.can_access_contact(organization_id, contact_id));
create policy contact_channel_identities_insert on public.contact_channel_identities for insert to authenticated with check (false);
create policy contact_channel_identities_update on public.contact_channel_identities for update to authenticated using (false) with check (false);
create policy contact_channel_identities_delete on public.contact_channel_identities for delete to authenticated using (false);

create policy member_channel_identities_select on public.organization_member_channel_identities for select to authenticated
  using (public.can_manage_sales(organization_id)
    or member_id = public.current_organization_member_id(organization_id));
create policy member_channel_identities_insert on public.organization_member_channel_identities for insert to authenticated with check (false);
create policy member_channel_identities_update on public.organization_member_channel_identities for update to authenticated using (false) with check (false);
create policy member_channel_identities_delete on public.organization_member_channel_identities for delete to authenticated using (false);

create policy message_drafts_select on public.message_drafts for select to authenticated
  using (public.can_manage_sales(organization_id)
    or owner_member_id = public.current_organization_member_id(organization_id));
create policy message_drafts_insert on public.message_drafts for insert to authenticated with check (false);
create policy message_drafts_update on public.message_drafts for update to authenticated using (false) with check (false);
create policy message_drafts_delete on public.message_drafts for delete to authenticated using (false);

create policy messages_select on public.messages for select to authenticated
  using (public.can_manage_sales(organization_id)
    or owner_member_id = public.current_organization_member_id(organization_id));
create policy messages_insert on public.messages for insert to authenticated with check (false);
create policy messages_update on public.messages for update to authenticated using (false) with check (false);
create policy messages_delete on public.messages for delete to authenticated using (false);

create policy delivery_events_select on public.delivery_events for select to authenticated
  using (public.can_manage_sales(organization_id) or exists (
    select 1 from public.messages m where m.organization_id = delivery_events.organization_id
      and m.id = delivery_events.message_id
      and m.owner_member_id = public.current_organization_member_id(delivery_events.organization_id)
  ));
create policy delivery_events_insert on public.delivery_events for insert to authenticated with check (false);
create policy delivery_events_update on public.delivery_events for update to authenticated using (false) with check (false);
create policy delivery_events_delete on public.delivery_events for delete to authenticated using (false);

create policy assignment_settings_select on public.organization_assignment_settings for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy assignment_settings_insert on public.organization_assignment_settings for insert to authenticated with check (false);
create policy assignment_settings_update on public.organization_assignment_settings for update to authenticated using (false) with check (false);
create policy assignment_settings_delete on public.organization_assignment_settings for delete to authenticated using (false);

create policy assignment_history_select on public.assignment_history for select to authenticated
  using (public.can_access_lead(organization_id, lead_id));
create policy assignment_history_insert on public.assignment_history for insert to authenticated with check (false);
create policy assignment_history_update on public.assignment_history for update to authenticated using (false) with check (false);
create policy assignment_history_delete on public.assignment_history for delete to authenticated using (false);

create policy lead_source_connections_select on public.lead_source_connections for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy lead_source_connections_insert on public.lead_source_connections for insert to authenticated with check (false);
create policy lead_source_connections_update on public.lead_source_connections for update to authenticated using (false) with check (false);
create policy lead_source_connections_delete on public.lead_source_connections for delete to authenticated using (false);

create policy inbound_events_select on public.inbound_events for select to authenticated
  using (public.can_manage_sales(organization_id)
    or (lead_id is not null and public.can_access_lead(organization_id, lead_id)));
create policy inbound_events_insert on public.inbound_events for insert to authenticated with check (false);
create policy inbound_events_update on public.inbound_events for update to authenticated using (false) with check (false);
create policy inbound_events_delete on public.inbound_events for delete to authenticated using (false);

create policy command_executions_select on public.command_executions for select to authenticated
  using (public.can_administer_organization(organization_id) or actor_user_id = auth.uid());
create policy command_executions_insert on public.command_executions for insert to authenticated with check (false);
create policy command_executions_update on public.command_executions for update to authenticated using (false) with check (false);
create policy command_executions_delete on public.command_executions for delete to authenticated using (false);

create policy outbox_events_select on public.outbox_events for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy outbox_events_insert on public.outbox_events for insert to authenticated with check (false);
create policy outbox_events_update on public.outbox_events for update to authenticated using (false) with check (false);
create policy outbox_events_delete on public.outbox_events for delete to authenticated using (false);

create policy automation_runs_select on public.automation_runs for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy automation_runs_insert on public.automation_runs for insert to authenticated with check (false);
create policy automation_runs_update on public.automation_runs for update to authenticated using (false) with check (false);
create policy automation_runs_delete on public.automation_runs for delete to authenticated using (false);

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy audit_logs_insert on public.audit_logs for insert to authenticated with check (false);
create policy audit_logs_update on public.audit_logs for update to authenticated using (false) with check (false);
create policy audit_logs_delete on public.audit_logs for delete to authenticated using (false);

create policy purge_jobs_select on public.organization_purge_jobs for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy purge_jobs_insert on public.organization_purge_jobs for insert to authenticated with check (false);
create policy purge_jobs_update on public.organization_purge_jobs for update to authenticated using (false) with check (false);
create policy purge_jobs_delete on public.organization_purge_jobs for delete to authenticated using (false);

create policy organization_tombstones_select on public.organization_tombstones for select to authenticated using (false);
create policy organization_tombstones_insert on public.organization_tombstones for insert to authenticated with check (false);
create policy organization_tombstones_update on public.organization_tombstones for update to authenticated using (false) with check (false);
create policy organization_tombstones_delete on public.organization_tombstones for delete to authenticated using (false);

grant select on all tables in schema public to authenticated;
grant insert, update on public.profiles to authenticated;
