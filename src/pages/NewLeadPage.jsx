import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/context";
import { PageHeader } from "../components/AsyncState";
import { SectionHeading } from "../components/WorkspaceUI";
import {
  buildManualLeadPayload,
  createManualLead,
  demoManualLead,
  emptyManualLead,
  validateManualLeadForm,
} from "../lib/manualLead";
import { toUserMessage } from "../lib/errors";

const urgencyOptions = [
  ["", "暂不确定"],
  ["immediate", "立即处理（7 天内）"],
  ["high", "高（30 天内）"],
  ["medium", "中（90 天内）"],
  ["low", "低（90 天以上）"],
];

export function NewLeadPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const demoMode = params.get("demo") === "1";
  const sourceEventId = useRef(crypto.randomUUID());
  const [values, setValues] = useState(() => demoMode ? demoManualLead : emptyManualLead);
  const [feedback, setFeedback] = useState(() => demoMode ? { type: "success", message: "虚拟演示客户已填入。检查后点击底部按钮即可创建，不会联系真实客户。" } : null);
  const [working, setWorking] = useState(false);
  const isSales = auth.membership.role === "sales";

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setFeedback(null);
    const validationError = validateManualLeadForm(values);
    if (validationError) {
      setFeedback({ type: "error", message: validationError });
      return;
    }
    setWorking(true);
    try {
      const payload = buildManualLeadPayload(
        values,
        auth.organization.id,
        sourceEventId.current,
      );
      const result = await createManualLead(payload);
      navigate(`/leads/${result.lead_id}`, {
        replace: true,
        state: { createdManually: true, intakeStatus: result.status },
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: toUserMessage(error, "线索没有创建成功，请稍后再试。"),
      });
    } finally {
      setWorking(false);
    }
  }

  return <section className="workspace-page manual-lead-page">
    <PageHeader
      eyebrow="手工录入"
      title="新建线索"
      description="把电话、微信、展会或转介绍获得的客户录入 CRM。提交后会直接进入线索工作台。"
      actions={<button className="button button--secondary" onClick={() => { setValues(demoManualLead); setFeedback({ type: "success", message: "虚拟演示客户已填入。检查后点击底部按钮即可创建，不会联系真实客户。" }); }} type="button">填入演示客户</button>}
    />

    <div className="notice notice--warning manual-lead-notice">
      <strong>这会在当前企业中创建真实测试记录</strong>
      <p>{isSales ? "创建后线索会自动归属给你。" : "创建后线索进入未分配池，你可以在线索工作台分配销售。"} 手工填写的电话和邮箱不会自动标记为已验证，避免误合并客户。</p>
    </div>

    {feedback && <div className={`feedback feedback--${feedback.type}`} role="alert">{feedback.message}</div>}

    <form className="manual-lead-form" onSubmit={submit}>
      <article className="panel">
        <SectionHeading eyebrow="第 1 部分" title="客户是谁" description="姓名必填，电话、邮箱或微信至少填写一项。" />
        <div className="form-grid form-grid--two">
          <label>客户姓名<input autoComplete="name" maxLength="120" onChange={(event) => update("name", event.target.value)} required value={values.name} /></label>
          <label>公司名称<input autoComplete="organization" maxLength="200" onChange={(event) => update("company", event.target.value)} value={values.company} /></label>
          <label>手机或电话<input autoComplete="tel" maxLength="40" onChange={(event) => update("phone", event.target.value)} placeholder="例如：00000000000（仅演示）" value={values.phone} /></label>
          <label>邮箱<input autoComplete="email" maxLength="320" onChange={(event) => update("email", event.target.value)} type="email" value={values.email} /></label>
          <label>微信号<input maxLength="120" onChange={(event) => update("wechat", event.target.value)} value={values.wechat} /></label>
        </div>
      </article>

      <article className="panel">
        <SectionHeading eyebrow="第 2 部分" title="客户需要什么" description="这些信息会进入 AI 证据提取和标准评分流程。" />
        <div className="stack-form">
          <label>具体需求<textarea maxLength="2000" onChange={(event) => update("need", event.target.value)} placeholder="客户遇到什么问题，希望系统解决什么？" required rows="5" value={values.need} /></label>
          <div className="form-grid form-grid--two">
            <label>预算（人民币）<input max="1000000000000" min="0" onChange={(event) => update("budget", event.target.value)} placeholder="例如：100000" step="1" type="number" value={values.budget} /></label>
            <label>紧急程度<select onChange={(event) => update("urgency", event.target.value)} value={values.urgency}>{urgencyOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label>补充备注<textarea maxLength="5000" onChange={(event) => update("notes", event.target.value)} placeholder="决策人、预计上线时间、客户反馈等" rows="4" value={values.notes} /></label>
        </div>
      </article>

      <article className="panel manual-lead-submit">
        <label className="check"><input checked={values.contactPermission} onChange={(event) => update("contactPermission", event.target.checked)} required type="checkbox" />已确认企业拥有记录并联系该客户的合法依据</label>
        <p>提交时系统会保存录入来源与操作人，但不会把联系方式或 Secret 输出到日志。</p>
        <div className="page-actions">
          <button className="button button--primary" disabled={working} type="submit">{working ? "正在创建…" : "创建并进入线索工作台"}</button>
          <Link className="button button--secondary" to="/leads">取消</Link>
        </div>
      </article>
    </form>
  </section>;
}
