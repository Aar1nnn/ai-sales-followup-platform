# n8n 调用图

```mermaid
sequenceDiagram
  participant DB as Supabase Outbox
  participant D as CN-01 Dispatcher
  participant W as 子 Workflow
  participant AI as OpenAI-compatible API
  participant E as Edge Functions
  D->>DB: claim_outbox_events(SKIP LOCKED)
  DB-->>D: pending event batch
  D->>W: Execute Workflow + even
  opt AI evidence or draf
    W->>DB: GET RLS-bypassed service contex
    W->>AI: customer credential
    AI-->>W: structured evidence/draf
  end
  W->>E: execute-command / channel-send
  E->>DB: one transactional RPC
  DB-->>E: result + new outbox
  E-->>W: stable response
  W-->>D: success
  D->>DB: complete_outbox_even
```

失败执行由 CN-10 写 `automation_runs`；处理中的事件 15 分钟后恢复，超过最大尝试进入 dead letter。未知但合法事件由 Dispatcher 直接完成，防止队列永久卡死。当前 mapping：Intake → Score → Assignment → Draft → Feishu，Reminder → Feishu，Purge → Edge worker。

日报与清理是受控 schedule：日报只读指标并调用 Feishu；Retention 只调用 `crm.run_retention_cleanup`；Reminder Enqueuer 只调用 `crm.enqueue_due_automation_events`。
