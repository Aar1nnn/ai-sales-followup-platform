# 全新 GitHub 架构仓库发布记录

## 当前目标

从完整本地实现生成一个无旧 Git 历史、无客户数据、无凭据和无部署现场元数据的新仓库，并在全部质量门禁通过后上传 GitHub。

## 已完成

- 审计原主仓库、完整功能工作树、远程仓库和 Git 历史。
- 确认公开范围：前端、Supabase、Edge、n8n 中国版模板、测试、部署与架构文档。
- 排除本地环境文件、截图、演示录屏、远程验收记录、个人账号、密码重置脚本、部署 UUID 和历史 workflow credential metadata。
- 生成基于文件白名单的干净发布快照。
- 经依赖审计确认旧 NestJS 兼容后端存在高风险漏洞且不在生产调用链，已从公开架构范围排除；原始本地实现保持不变。
- 初始化全新的本地 Git 仓库，默认分支为 `main`，并推送到全新公开远程仓库。
- 应用 `vitest 4.1.11` 与 `nanoid 3.3.19` 安全补丁，`npm audit` 当前为 0 漏洞。
- 通过 ESLint、Vitest（47 项）、Vite production build、n8n JSON/连接图校验、Secret 扫描、公开数据扫描和 Docker Compose 静态配置校验。
- 通过 5 项无需数据库的 Playwright 路由与登录保护测试；6 项依赖 seeded local Supabase 的场景按测试条件跳过。
- 已创建并推送 `Aar1nnn/ai-sales-followup-platform`，远程可见性为 public、默认分支为 `main`。
- 远程 tree 共 172 个文件，不包含 `backend/` 或被禁止的现场证据目录。
- 远程 CI 在两套全新 Supabase 环境中分别完成 17 个 migration 和 125 项 pgTAP；应用、Edge、数据库与部署配置四个 job 全部通过。
- 根据 GitHub 官方最新发布将 `actions/checkout`、`actions/setup-node` 升级到 v7，并将 runner 固定为 `ubuntu-24.04`。

## 当前决策

- 使用全新的 Git 历史，不复用旧仓库提交。
- n8n 仅发布 10 个默认关闭的中国版 workflow。
- 所有开发数据必须使用示例域名、确定性测试 UUID 和明显虚构身份。
- 用户已确认发布到 `Aar1nnn/ai-sales-followup-platform`，可见性为 public。
- 公开可见不等于授予开源许可；本轮不添加许可证文件。

## 修改文件

- 新增公开边界、隐私扫描与发布计划。
- 调整 README、CI、n8n 校验、Secret 扫描、演示数据与历史兼容说明。

## 测试状态

- 已通过：`npm run lint`。
- 已通过：`npm run check` 连续门禁，其中 Vitest 为 12 个测试文件、47 项测试。
- 已通过：`npm run build`。
- 已通过：`npm run test:n8n`，10 个工作流均为 inactive。
- 已通过：`npm run test:secrets`，171 个仓库文件和空白 Git 历史未发现 Secret。
- 已通过：`npm run test:privacy`，171 个仓库文件未发现被禁止的客户/部署数据。
- 已通过：5 项 Playwright 路由与登录保护测试。
- 已通过：`docker compose ... config --quiet` 静态校验。
- 已通过：`npm audit --audit-level=low`，0 漏洞。
- 已通过：Deno 2 `fmt --check`、7 个 Edge 入口类型检查和 10 项 Edge 契约测试。
- 已通过：两套 disposable Supabase 环境，17 个 migration、development seed 和每套 125 项 pgTAP。
- 未执行：需要同一进程保留 seeded Supabase 的 6 项 Authenticated Playwright 场景。

## 已知问题

- Authenticated Playwright 仍需在同一 runner 中同时启动 seeded Supabase 与前端；当前 CI 仅覆盖 5 项未登录路由场景。

## 下一步

1. 客户部署前按开户手册配置其自有 Supabase、n8n、飞书和 AI 凭据。
2. 后续将 6 项 Authenticated Playwright 场景接入同一套临时 Supabase runner。
