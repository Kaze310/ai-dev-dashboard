# AI Dev Dashboard

给 AI 开发者用的 API 花费监控面板，把 OpenAI、Anthropic 等多个 provider 的用量和花费统一到一个界面里看。

## 项目目标
当你同时使用多个 AI API 时，不需要分别登录各家平台查看账单和使用情况；在一个 Dashboard 内完成统一查看和预算管理。

## 解决的问题
- 多 Provider 的花费和用量分散在不同后台，缺少统一视图
- 月度成本难以及时感知，容易超预算
- 缺少可视化趋势和按模型/平台的对比分析

## 核心功能
1. **多 Provider 数据聚合**
   - 接入 OpenAI、Anthropic 的 Usage API
   - 统一拉取用量与花费数据并标准化
2. **可视化 Dashboard**
   - 花费趋势图
   - 按 model 分类
   - 按 provider 对比
   - 日/周/月维度切换
3. **预算告警**
   - 设定月度预算上限
   - 接近或超出预算时提醒
4. **API Key 管理**
   - 安全存储和管理各 provider 的 API key
5. **用户认证**
   - 登录/注册
   - 用户数据隔离

## 技术栈
- **前端：** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Recharts
- **后端/数据库：** Supabase (PostgreSQL + Auth + Row Level Security)
- **部署：** Vercel
- **API 数据源：** OpenAI Usage API, Anthropic Usage API

## 项目边界（不做什么）
- 不做实时 streaming 监控
- 不做 API 代理/转发
- 不做多租户 SaaS 运营
- 自用工具，不追求大规模用户

## 当前状态（2026-03-03 更新）

### ✅ 已完成
1. Next.js 14 + TypeScript + Tailwind 项目初始化
2. Supabase 配置（Auth、PostgreSQL、RLS）
3. OpenAI Usage API 集成 + 数据同步
4. Anthropic Usage API 集成 + 数据同步
5. Recharts 可视化图表（花费趋势、模型分类、Token 用量）
6. Cost Summary 组件（Today / Month / YTD 切换）
7. 预算告警系统（全局预算 + per-provider 预算，进度条 + Banner）
8. API Key 管理（加密存储、Settings UI）

### ⬜ 待做
- UI 美化 & UX 优化
- Vercel 部署

### 🐛 已知问题
- UTC 时间差：provider 返回 UTC bucket date，与本地日期可能有一天偏移
- Anthropic 当天数据：当天 usage 无法实时获取，可能需要改代码适配
