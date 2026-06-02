# 考研AI助手 · 产品架构设计

## 1. 产品定位

面向个人考研学生的 AI 学习辅助工具。核心能力：

- **长计划管理** — 从备考到考试的全周期计划编排
- **每日目标跟踪** — 日粒度任务拆解 + 复盘
- **知识体系** — 树形知识点图谱 + 掌握度追踪
- **学习资料整合** — 通过 WebDAV 对接夸克网盘，AI 可读取课程/习题
- **AI 智能辅助** — 计划推荐、进度分析、知识点-资料匹配

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (Web SPA)                        │
│   React 18 + TypeScript + Tailwind CSS + shadcn/ui      │
│   ├─ Dashboard      每日概览                             │
│   ├─ PlanView       长计划甘特图                          │
│   ├─ KnowledgeTree  知识点树                              │
│   ├─ Materials      学习资料浏览器 (WebDAV)               │
│   ├─ StudyTimer     番茄钟/学习记录                        │
│   └─ AIChat         AI 对话面板                           │
└───────────────┬─────────────────────────────────────────┘
                │  Supabase Client SDK (supabase-js)
                │  + WebDAV Proxy (Edge Function)
┌───────────────▼─────────────────────────────────────────┐
│                    Supabase (BaaS)                       │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Auth   │  │  PostgreSQL   │  │  Edge Functions  │   │
│  │  (用户)  │  │  (业务数据)   │  │  (WebDAV代理/AI) │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│                                                         │
│  ┌──────────┐  ┌──────────────┐                         │
│  │  Storage │  │   Realtime   │                         │
│  │ (文件)   │  │  (实时推送)  │                         │
│  └──────────┘  └──────────────┘                         │
└───────────────┬─────────────────────────────────────────┘
                │  WebDAV Protocol
┌───────────────▼─────────────────────────────────────────┐
│              夸克网盘 (WebDAV Server)                     │
│  ├─ /courses/        课程视频 (mp4)                       │
│  ├─ /exercises/      练习题 (pdf)                        │
│  ├─ /notes/          笔记资料                             │
│  └─ /papers/         真题试卷                             │
└─────────────────────────────────────────────────────────┘
```

### 技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| 前端框架 | React 18 + TypeScript | 生态成熟，组件化开发 |
| 样式 | Tailwind CSS + shadcn/ui | 快速出 UI，暗色模式 |
| 后端/BaaS | Supabase | 自带 Auth/DB/Storage/EdgeFn |
| 数据库 | PostgreSQL (Supabase) | 支持树形查询(RECURSIVE CTE)、JSON |
| API | supabase-js SDK + Edge Functions | 直连 DB，省去中间层 |
| WebDAV | Edge Function 代理 | 浏览器端无法直连 WebDAV 需要服务端中转 |
| AI | OpenAI API (通过 Edge Function) | 计划生成、资料分析 |

---

## 3. 功能模块

### 3.1 长计划模块 (Plan)

```
考研数学总计划 (2025.3 → 2026.12)
├── 基础阶段 (3月-6月)
│   ├── 高等数学上册  ☑ 完成
│   ├── 高等数学下册  ☑ 完成
│   └── 线性代数       ◷ 进行中
├── 强化阶段 (7月-9月)
│   ├── 高数强化
│   ├── 线代强化
│   └── 概率论强化
└── 冲刺阶段 (10月-12月)
    ├── 真题模拟
    └── 查漏补缺
```

**能力：**
- 创建多级计划（考试 → 科目 → 阶段 → 知识点）
- 甘特图可视化时间线
- 根据考试倒计时自动调整计划密度
- AI 建议：基于已掌握知识点智能推荐复习重点

### 3.2 每日目标模块 (DailyGoal)

```
📅 2026-05-30 Day 187  进度 80%  心情 😊
├── ☑ 完成定积分习题第三章         30min → 35min
├── ☑ 英语阅读理解2篇             45min → 40min
├── ◷ 观看线代课程视频(特征值)     60min
└── ⬜ 复习政治近代史纲要           30min

📝 今日复盘：定积分换元法还需加强练习...
```

**能力：**
- 每天自动/手动生成目标项
- 番茄钟计时 + 实际用时统计
- 完成率可视化
- 每日复盘 + 心情记录
- AI 自动生成次日计划建议

### 3.3 知识体系模块 (Knowledge)

```
📚 高等数学
├── 📁 函数与极限
│   ├── 📄 函数的概念          ★★★★☆ 未掌握
│   ├── 📄 数列极限            ★★★★★ 已掌握
│   └── 📄 函数极限            ★★★☆☆ 学习中
├── 📁 一元微分学
│   ├── 📄 导数定义            ★★★★★ 已掌握
│   ├── 📄 微分中值定理        ★★★☆☆ 学习中
│   └── ...
└── ...
```

**能力：**
- 树形知识点结构，无限层级
- 难度/重要性打分 (1-5)
- 掌握状态追踪
- 关联学习资料（视频、习题）
- AI 诊断薄弱环节

### 3.4 学习资料模块 (Materials + WebDAV)

```
📂 夸克网盘
├── 📁 张宇高数基础班
│   ├── 🎬 01-函数极限.mp4          [关联: 函数极限]
│   ├── 🎬 02-导数定义.mp4          [关联: 导数定义]
│   └── 📄 讲义.pdf                 [关联: 一元微分学]
├── 📁 660题
│   ├── 📄 高数部分.pdf             [关联: 高等数学]
│   └── 📄 线代部分.pdf
└── 📁 历年真题
    └── 📄 2024年数学一.pdf
```

**工作流：**
1. 用户在夸克配置 WebDAV 地址和密码
2. 系统通过 Edge Function 列出网盘文件
3. 用户将文件与知识点手动/AI自动关联
4. 在知识树中点击知识点 → 直接看到对应视频/文档

### 3.5 AI 智能模块

| 场景 | AI 能力 |
|---|---|
| 计划生成 | 根据考试日期、科目、个人时间生成分阶段计划 |
| 每日建议 | 基于进度+薄弱点推荐今日学习内容 |
| 资料匹配 | 自动将 WebDAV 文件名匹配到知识点 |
| 进度分析 | 周/月报告，可视化薄弱环节 |
| 智能问答 | 基于上下文回答学习问题 |

---

## 4. 数据流

### 4.1 核心数据流

```
用户操作                          AI 介入
────────                         ────────
创建考试信息                      ↓
    │                      AI 生成初始计划
    ▼                             ↓
创建长计划 ←──────────────── 填充阶段+知识点
    │
    ▼
每日目标生成 ←──────────────── AI 推荐今日任务
    │
    ├── 番茄钟计时 → 学习记录
    ├── 完成/跳过 → 更新掌握度
    └── 复盘 → 写入反思
           │
           ▼
    AI 周报分析 ← 汇总学习数据
```

### 4.2 WebDAV 数据流

```
浏览器                     Supabase Edge Function           夸克 WebDAV
  │                              │                              │
  ├─ listFiles("/courses") ────►│                              │
  │                              ├─ PROPFIND /courses ────────►│
  │                              │◄──── 207 XML ──────────────┤
  │◄── JSON 文件列表 ───────────┤                              │
  │                              │                              │
  ├─ getFile("/courses/01.mp4")─►│                              │
  │                              ├─ GET /courses/01.mp4 ──────►│
  │                              │◄──── 视频流 ────────────────┤
  │◄── 视频流 ─────────────────┤                              │
```

---

## 5. 数据库 ER 概览

```
┌──────────┐       ┌──────────────┐       ┌───────────────┐
│ exam_info│ 1──N  │    plans     │ 1──N  │  plan_phases  │
│ (考试)   │       │  (长计划)     │       │   (计划阶段)   │
└──────────┘       └──────┬───────┘       └───────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   1──N   │         1──N  │         1──N  │
┌─────────▼──┐  ┌─────────▼──┐  ┌─────────▼──────┐
│  subjects  │  │daily_goals │  │knowledge_points│
│  (科目)    │  │ (每日目标)  │  │   (知识点)      │
└─────┬──────┘  └──────┬─────┘  └────────┬────────┘
      │                │                 │
 1──N │          1──N  │           1──N  │
┌─────▼──────────┐ ┌──▼───────────┐ ┌───▼──────────────┐
│knowledge_points│ │daily_goal_   │ │learning_materials│
│   (知识点)      │ │   items      │ │  (学习资料)       │
└────────────────┘ │ (目标项)      │ └────────┬─────────┘
                   └───────────────┘          │
                                       N──1   │
                                    ┌─────────▼──────┐
                                    │ webdav_configs │
                                    │  (WebDAV配置)   │
                                    └────────────────┘

┌────────────────┐
│study_sessions  │── 关联 goal_items / knowledge_points / materials
│  (学习记录)     │
└────────────────┘
```

### 核心表 (10张)

| 表 | 说明 | 关键字段 |
|---|---|---|
| `exam_info` | 考试信息（日期倒计时） | name, exam_date |
| `subjects` | 考试科目 | name, code, color |
| `plans` | 长计划 | name, start/end_date, status |
| `plan_phases` | 计划阶段 | plan_id, name, sequence |
| `knowledge_points` | 知识点（树形） | subject_id, parent_id, difficulty, importance, is_mastered |
| `daily_goals` | 每日目标 | plan_id, date, completion_rate, reflection, mood |
| `daily_goal_items` | 目标项 | daily_goal_id, kp_id, material_id, status |
| `learning_materials` | 学习资料 | kp_id, webdav_path, type, file_type |
| `webdav_configs` | WebDAV 配置 | url, username, password |
| `study_sessions` | 学习记录 | goal_item_id, start/end_time, duration |

---

## 6. 安全设计

- **认证**: Supabase Auth (Email + OAuth)
- **RLS**: 所有表启用 Row Level Security，按 `user_id = auth.uid()` 隔离
- **WebDAV密码**: Edge Function 内使用 Supabase Vault 存储敏感凭据
- **API 鉴权**: Edge Function 验证 JWT，确保用户只能访问自己的数据

---

## 7. 开发路线图

| 阶段 | 内容 | 产出 |
|---|---|---|
| **Phase 1** (当前) | 数据库设计与部署 | Supabase 迁移脚本 + RLS |
| **Phase 2** | WebDAV 连接器 | Edge Function 代理夸克 |
| **Phase 3** | 前端骨架 | React 项目 + 路由 + 布局 |
| **Phase 4** | 核心功能 | 计划/目标/知识点 CRUD |
| **Phase 5** | AI 集成 | 计划生成 + 每日建议 |
| **Phase 6** | 打磨 | 统计面板 + 数据可视化 |

---

> 下一阶段：根据此架构设计，生成 Supabase 数据库迁移 SQL 脚本。

## 8. 向量数据库设计 (pgvector)

### 8.1 为什么需要向量？

传统关系型数据库只能做精确匹配（`WHERE name LIKE "%函数极限%"`），
但 AI 需要**语义理解**：

| 场景 | 传统SQL | 向量检索 |
|---|---|---|
| "找和导数相关的知识点" | LIKE 匹配不到"微分""求导" | ✅ 语义相近自动召回 |
| "这个视频讲什么内容" | 只能靠标题匹配 | ✅ 内容embedding匹配 |
| "我最近薄弱环节是什么" | 需要人工打标签 | ✅ 学习模式聚类分析 |
| "推荐相似难度的练习题" | 需要手动标注难度 | ✅ 多维特征向量相似度 |

### 8.2 Supabase pgvector 方案

```
┌─────────────────────────────────────────────────┐
│              pgvector Extension                  │
│                                                 │
│  ┌─────────────────┐  ┌───────────────────────┐ │
│  │ knowledge_points │  │  learning_materials    │ │
│  │  + embedding     │  │  + embedding           │ │
│  │  vector(1536)    │  │  vector(1536)          │ │
│  └────────┬────────┘  └───────────┬───────────┘ │
│           │                       │             │
│           └───────┬───────────────┘             │
│                   │                             │
│  ┌────────────────▼──────────────────────────┐  │
│  │         study_patterns                     │  │
│  │  + embedding  vector(1536)                 │  │
│  │  (学习行为向量: 时段/时长/科目/完成率...)    │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  索引: IVFFlat (快速近似检索)                     │
│  距离: cosine (语义相似度)                        │
└─────────────────────────────────────────────────┘
```

### 8.3 Embedding 策略

| 实体 | 嵌入内容 | 维度 | 生成时机 | 用途 |
|---|---|---|---|---|
| **知识点** | `name + description` 拼接 | 1536 | 创建/更新时 Edge Function 调用 OpenAI | 相似知识点推荐、薄弱点聚类 |
| **学习资料** | `title + type + notes` 拼接 | 1536 | 文件关联时 | 自动匹配资料→知识点 |
| **学习模式** | `{时段, 科目分布, 完成率, 时长, 心情}` JSON化 | 1536 | 每日复盘后 | 学习习惯分析、AI建议优化 |

### 8.4 典型查询示例

```sql
-- 1. 找与"函数极限"最相似的5个知识点
SELECT kp.name, kp.description,
       1 - (kp.embedding <=> query_embedding) AS similarity
FROM knowledge_points kp
WHERE kp.user_id = 'xxx'
ORDER BY kp.embedding <=> query_embedding
LIMIT 5;

-- 2. 自动匹配视频到知识点
SELECT kp.name, lm.title,
       1 - (lm.embedding <=> kp.embedding) AS match_score
FROM learning_materials lm
CROSS JOIN knowledge_points kp
WHERE lm.user_id = 'xxx' AND kp.user_id = 'xxx'
  AND lm.knowledge_point_id IS NULL  -- 未关联的
ORDER BY lm.embedding <=> kp.embedding
LIMIT 10;

-- 3. 找出学习模式相似的历史日期
SELECT dg.date, dg.completion_rate, dg.mood,
       1 - (sp.embedding <=> today_embedding) AS similarity
FROM study_patterns sp
JOIN daily_goals dg ON dg.id = sp.daily_goal_id
WHERE sp.user_id = 'xxx'
ORDER BY sp.embedding <=> today_embedding
LIMIT 5;
```

### 8.5 向量生成流程

```
用户操作                Edge Function              OpenAI API
───────                ─────────────               ──────────
创建知识点 ──────────► 接收 name+description
                      拼接文本 ──────────────────► text-embedding-3-small
                      接收向量 ◄────────────────── 返回 1536维向量
                      写入 knowledge_points.embedding
                      
关联资料 ────────────► 接收 title+type+notes
                      拼接文本 ──────────────────► text-embedding-3-small
                      接收向量 ◄────────────────── 
                      写入 learning_materials.embedding
                      自动执行相似度匹配 (SQL查询)
                      返回 Top-5 知识点建议给用户确认
```

---

> 向量数据库是 AI 理解数据的桥梁。pgvector 零额外运维成本，与 PostgreSQL 原生集成。
