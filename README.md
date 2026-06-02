# 考研AI助手 · 快速部署指南

## 前置条件

1. [Supabase](https://supabase.com) 账号 + 项目
2. [OpenAI API Key](https://platform.openai.com/api-keys) (用于 embedding)
3. [夸克网盘](https://pan.quark.cn) WebDAV 地址 (设置 → WebDAV)

---

## 一、数据库部署 (5分钟)

### 方式A: Supabase Dashboard (推荐)

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard) → 你的项目
2. 左侧菜单 → **SQL Editor**
3. 点击 **New query**
4. 复制 `supabase/migrations/001_init.sql` 全部内容
5. 粘贴并点击 **Run** (Ctrl+Enter)
6. 确认所有表创建成功

### 方式B: Supabase CLI (可选)

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### 方式C: psql 直连

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" -f supabase/migrations/001_init.sql
```

---

## 二、Edge Function 部署 (向量化核心)

### 2.1 部署 generate-embedding

```bash
# 进入项目目录
cd supabase

# 部署函数
supabase functions deploy generate-embedding

# 设置 OpenAI Key
supabase secrets set OPENAI_API_KEY=sk-your-key-here
```

### 2.2 验证

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/generate-embedding" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "table": "knowledge_points",
    "record": {
      "id": "test-123",
      "name": "函数极限",
      "description": "函数在某一点处的极限定义"
    }
  }'
```

---

## 三、向量化使用流程

```
┌──────────────┐     ┌─────────────────┐     ┌──────────┐
│  前端/App     │     │  Edge Function   │     │ OpenAI   │
│              │     │                  │     │          │
│ 创建知识点 ──►│     │                  │     │          │
│              │───►│ POST /generate   │     │          │
│              │     │  -embedding      │───►│ Embedding│
│              │     │                  │◄───│ API      │
│              │     │ 写入 kp.embedding│     │          │
│              │◄───│                  │     │          │
│              │     │                  │     │          │
│ 关联资料 ───►│     │                  │     │          │
│              │───►│ POST /generate   │     │          │
│              │     │  -embedding      │───►│ Embedding│
│              │     │                  │◄───│ API      │
│              │     │ 写入 lm.embedding│     │          │
│              │     │                  │     │          │
│              │     │ 自动匹配 ────────►     │          │
│              │     │ lm.embedding <=>       │          │
│              │     │ kp.embedding           │          │
│              │◄───│ 返回 Top-5 匹配        │          │
└──────────────┘     └─────────────────┘     └──────────┘
```

### 向量相似度检索 (SQL直接查询)

```sql
-- 1. 上传资料后, 自动匹配最相关的知识点
SELECT * FROM match_materials_to_knowledge_points(
  '<user_id>',
  '<material_id>',
  5  -- 返回Top-5
);

-- 2. 根据知识点找相似知识点 (薄弱环节诊断)
SELECT * FROM search_similar_knowledge_points(
  '<user_id>',
  '<知识点的embedding向量>',
  5,
  0.75
);

-- 3. 分析学习模式相似的历史日期
SELECT * FROM search_similar_study_patterns(
  '<user_id>',
  '<今日学习模式向量>',
  5
);
```

---

## 四、表结构速查

| 表 | 用途 | 向量字段 |
|---|---|---|
| `exam_info` | 考试信息(倒计时) | - |
| `subjects` | 科目(政治/英语/数学...) | - |
| `plans` | 长计划 | - |
| `plan_phases` | 计划阶段 | - |
| `knowledge_points` | 知识点(树形) | `embedding VECTOR(1536)` |
| `webdav_configs` | 夸克WebDAV配置 | - |
| `learning_materials` | 学习资料 | `embedding VECTOR(1536)` |
| `daily_goals` | 每日目标 | - |
| `daily_goal_items` | 目标项 | - |
| `study_sessions` | 学习计时 | - |
| `study_patterns` | 学习行为模式 | `embedding VECTOR(1536)` |

---

## 五、文件结构

```
ky-platform/
├── docs/
│   └── ARCHITECTURE.md          # 产品架构文档
├── supabase/
│   ├── migrations/
│   │   ├── 001_init.sql         # 核心数据库迁移 (10表+RLS+函数)
│   │   └── 002_auto_embedding.sql # 自动向量化触发器
│   └── functions/
│       └── generate-embedding/
│           └── index.ts         # Edge Function: 向量生成
└── README.md                    # 本文件
```
