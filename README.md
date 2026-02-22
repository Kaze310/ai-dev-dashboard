# AI Dev Dashboard

中文版 | [English](#english)

给 AI 开发者用的 API 花费监控面板，把 OpenAI、Anthropic 等多个 provider 的用量和花费统一到一个界面里看。

## 项目目标
当你同时使用多个 AI API 时，不需要分别登录各家平台查看账单和使用情况；在一个 Dashboard 内完成统一查看和预算管理。

## 解决的问题
- 多 Provider 的花费和用量分散在不同后台，缺少统一视图
- 月度成本难以及时感知，容易超预算
- 缺少可视化趋势和按模型/平台的对比分析

## 核心功能
1. 多 Provider 数据聚合
接入 OpenAI、Anthropic Usage API，统一拉取并标准化用量与花费数据。
2. 可视化 Dashboard
提供花费趋势图、按 model 分类、按 provider 对比，并支持日/周/月维度切换。
3. 预算告警
支持设置月度预算上限，在接近或超出预算时提醒。
4. API Key 管理
安全存储和管理各 provider 的 API key。
5. 用户认证
支持登录注册与用户数据隔离。

## 技术栈
- 前端：Next.js 14+ (App Router) + TypeScript + Tailwind CSS + Recharts
- 后端/数据库：Supabase (PostgreSQL + Auth + Row Level Security)
- 部署：Vercel
- API 数据源：OpenAI Usage API, Anthropic Usage API

## 项目边界（不做什么）
- 不做实时 streaming 监控
- 不做 API 代理/转发
- 不做多租户 SaaS 运营
- 自用工具，不追求大规模用户

## 快速开始
```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

需要先配置环境变量（`.env.local`）：
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## English

A unified API cost monitoring dashboard for AI developers, aggregating usage and spending across providers like OpenAI and Anthropic into one view.

## Goal
If you use multiple AI APIs, you should not have to check separate dashboards to track costs. This project provides a single dashboard for usage visibility and budget control.

## Problems It Solves
- Cost and usage data are fragmented across providers
- Monthly spending is hard to track before going over budget
- There is no unified breakdown by provider/model/time period

## Core Features
1. Multi-provider aggregation
Fetch and normalize usage/cost data from OpenAI and Anthropic APIs.
2. Visualization dashboard
Show spending trends, model-level breakdowns, provider comparisons, and day/week/month views.
3. Budget alerts
Set monthly limits and get notified when approaching or exceeding thresholds.
4. API key management
Securely store and manage provider API keys.
5. Authentication
User sign-up/login with per-user data isolation.

## Tech Stack
- Frontend: Next.js 14+ (App Router) + TypeScript + Tailwind CSS + Recharts
- Backend/Database: Supabase (PostgreSQL + Auth + Row Level Security)
- Deployment: Vercel
- Data sources: OpenAI Usage API, Anthropic Usage API

## Out of Scope
- No real-time streaming monitoring
- No API proxy/forwarding
- No multi-tenant SaaS operations
- Personal/internal tool, not optimized for massive scale

## Quick Start
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Configure environment variables in `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```
