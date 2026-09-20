import { supabase } from "./supabase";

export async function readWorkQueue() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const [leads, tasks, drafts] = await Promise.all([
    supabase.from("leads").select(
      "id,public_id,status,need,owner_member_id,acknowledged_at,accepted_at,created_at,updated_at,contacts(full_name,phone),lead_scores(normalized_score,priority_level,coverage,confidence,scored_at)",
    ).in("status", ["new", "working", "qualified"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("follow_up_tasks").select(
      "id,title,status,due_at,lead_id,version,contacts(full_name),leads(id,public_id,status)",
    ).in("status", ["open", "snoozed"]).lte("due_at", endOfToday.toISOString()).order("due_at").limit(100),
    supabase.from("message_drafts").select(
      "id,status,content,lead_id,updated_at,version,contacts(full_name),leads(public_id)",
    ).in("status", ["draft", "pending_approval", "approved", "rejected"]).order("updated_at", { ascending: false }).limit(100),
  ]);
  const error = leads.error || tasks.error || drafts.error;
  return { data: error ? null : { leads: leads.data ?? [], tasks: tasks.data ?? [], drafts: drafts.data ?? [] }, error };
}
