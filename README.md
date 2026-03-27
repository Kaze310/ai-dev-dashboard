# AI Dev Dashboard

给 AI 开发者用的 API 花费监控面板，把 OpenAI、Anthropic 等多个 provider 的用量和花费统一到一个界面里看。

## 项目目标
当你同时使用多个 AI API 时，不需要分别登录各家平台查看账单和使用情况；在一个 Dashboard 内完成统一查看、预算管理和基础告警。

## 解决的问题
- 多 Provider 的花费和用量分散在不同后台，缺少统一视图
- 月度成本难以及时感知，容易超预算
- 缺少按 provider / model 维度的趋势和对比分析
- API key 管理和同步流程分散，重复操作多

## 核心功能
1. **多 Provider 数据聚合**
   - 接入 OpenAI、Anthropic 组织级 usage / cost API
   - 统一拉取用量与花费数据并标准化入库
2. **可视化 Dashboard**
   - Cost Summary（Today / This Month / YTD）
   - Daily Cost Trend
   - Cost by Model
   - Daily Token Usage
3. **预算告警**
   - 全局预算
   - Per-provider 预算
   - 进度条与阈值提醒
4. **API Key 管理**
   - OpenAI / Anthropic key 保存与更新
   - 服务端加密存储
   - 手动触发同步
5. **用户认证**
   - Supabase Auth 登录 / 注册
   - 用户数据隔离
6. **原始记录查看**
   - 独立 Records 页面查看最近同步的 usage rows

## 技术栈
- **前端：** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Recharts
- **后端 / 数据库：** Supabase (PostgreSQL + Auth + Row Level Security)
- **部署：** Vercel
- **API 数据源：** OpenAI Organization Usage / Costs API, Anthropic Usage / Cost Report API

## 当前状态

### 已完成
1. Next.js + TypeScript + Tailwind 项目初始化
2. Supabase Auth、PostgreSQL、RLS 配置
3. OpenAI usage / cost 同步
4. Anthropic usage / cost 同步
5. Dashboard 图表与 summary 视图
6. 全局预算 + per-provider 预算告警
7. Settings 页面（provider key + budget）
8. API key AES-256-GCM 加密存储
9. Records 独立页面
10. 浅色风格 UI 重构

### 暂未完成
- Vercel 正式部署
- 更细的 records 筛选 / 搜索
- 自动化定时同步
- 更完整的测试覆盖

## 本地运行

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
在项目根目录创建 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
API_KEY_ENCRYPTION_SECRET=your_random_secret
```

其中：
- `NEXT_PUBLIC_SUPABASE_URL`：Supabase 项目 URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase anon key
- `API_KEY_ENCRYPTION_SECRET`：用于加密 provider API key 的服务端密钥

可以用下面命令生成一串随机 secret：

```bash
openssl rand -base64 32
```

### 3. 启动开发环境
```bash
npm run dev
```

默认地址通常是：

```bash
http://localhost:3000
```

如果 3000 被占用，Next.js 会自动切换到其他端口。

## 数据库迁移
当前 migration 文件：

- `supabase/migrations/001_initial.sql`
- `supabase/migrations/002_usage_provider_constraints.sql`
- `supabase/migrations/003_20260303_budget_alerts.sql`

如果本地 / 线上数据库还没有最新字段，需要先执行对应 migration。

## API Key 说明
- OpenAI usage / cost 同步依赖 **Admin API key**
- Anthropic usage / cost 同步依赖 **组织管理员权限 key**
- 普通 project key 可能可以保存，但无法成功拉取组织级报表

## 安全说明
- provider key 保存在 `providers.api_key_encrypted`
- 当前实现已使用 `AES-256-GCM` 进行服务端加密
- 不兼容历史明文 key；部署加密版本前应清理旧 provider 记录并重新录入

## 已知问题
- `usage_records.date` 采用 provider 返回的 UTC bucket date，和本地自然日可能有一天偏移
- Anthropic 当天数据可能晚于控制台显示，需要次日或稍后再次同步
- Next.js 16 下 `middleware.ts` 约定已有弃用提示，后续应迁移到 `proxy`

## 项目边界
- 不做实时 streaming 监控
- 不做 API 代理 / 转发
- 不做多租户 SaaS 运营
- 自用工具，不追求大规模用户
