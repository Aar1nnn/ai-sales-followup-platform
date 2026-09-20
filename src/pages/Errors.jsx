import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { toUserMessage } from "../lib/errors";

export function RootErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `页面请求没有成功（状态码 ${error.status}）。`
    : toUserMessage(error, "页面没有正常加载，请返回总览后重试。");
  return <main className="error-page"><span className="eyebrow">系统错误</span><h1>页面没有正常加载</h1><p>{message}</p><Link className="button button--primary" to="/dashboard">返回总览</Link></main>;
}

export function ForbiddenPage() {
  return <main className="error-page"><span className="eyebrow">403</span><h1>没有访问权限</h1><p>当前账号没有有效的企业成员身份，或无权查看此内容。</p><Link className="button button--primary" to="/dashboard">返回总览</Link></main>;
}

export function NotFoundPage() {
  return <main className="error-page"><span className="eyebrow">404</span><h1>找不到页面</h1><p>链接可能已失效，或记录已被归档。</p><Link className="button button--primary" to="/dashboard">返回总览</Link></main>;
}
