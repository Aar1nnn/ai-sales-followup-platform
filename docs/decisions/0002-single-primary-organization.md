# ADR-0002：每套部署单一 primary organization

状态：已接受
日期：2026-08-05

生产环境每套部署只允许一个 active primary organization，但所有业务表保留 `organization_id`，RLS 和自动化测试保留两个组织。这样既符合客户独立部署和数据主权要求，又不会用单租户捷径削弱安全边界。v1 前端不提供组织切换器或集团视图。
