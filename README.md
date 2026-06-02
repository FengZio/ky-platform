# 考研AI助手 · ky-platform

基于大模型的智能考研学习平台，将考研资料转化为可语义检索的向量知识库，通过 Codex Agent 实现一对一 AI 辅导。

## 核心架构：4 层 AI 学习系统

### 1. 文档接入与智能切片

```
PDF/课件 → MinerU 解析 → Markdown → Chunker 切片 → 知识点块
```

| 模块 | 文件 | 职责 |
|------|------|------|
| MinerU 解析器 | `backend/src/services/mineru_parser.py` | 将 PDF 课件/试卷解析为结构化 Markdown，识别数学公式、表格 |
| Chunker 切片器 | `backend/src/services/chunker.py` | 按 Markdown 标题层级（##/###/####）切分为"知识点块"和"题目块"，支持识别目录、过滤无关内容 |

内置**知识点标签映射**：自动将关键词（如"导数""积分""二叉树"）归类到标准知识体系。

---

### 2. 向量化与语义匹配 (Embedding + pgvector)

```
文本内容 → OpenAI text-embedding-3-small → 1536维向量 → Supabase pgvector
```

| 模块 | 文件 | 职责 |
|------|------|------|
| Embedding 服务 | `backend/src/services/embedding.py` | 调用 OpenAI Embedding API，将知识点/资料文本转为 1536 维向量 |
| 向量存储 | Supabase `pgvector` 扩展 | IVFFlat 索引 + cosine 距离，高效语义检索 |

**三大核心查询：**

| 查询 | 用途 |
|------|------|
| 相似知识点推荐 | 找到语义最接近的其他知识点 |
| 资料自动关联 | 将未打标签的学习资料自动匹配到知识点 |
| 学习模式聚类 | 分析每日学习行为向量，找到相似的历史学习日 |

---

### 3. AI 对话辅导 (Codex Agent)

```
浏览器 WS → FastAPI relay → JSON-RPC over stdio → Codex app-server → 大模型
```

这是整个平台最核心的 AI 交互机制：

| 模块 | 文件 | 职责 |
|------|------|------|
| Codex 服务 | `backend/src/services/codex_service.py` | Session 管理，每个用户一个 LearningSession，spawn 独立 Codex app-server 子进程 |
| 学习服务 | `backend/src/services/learning_service.py` | 对话流程编排，知识库 RAG 增强 |
| 中继服务 | `backend/src/services/relay_service.py` | WebSocket ↔ JSON-RPC 2.0 over stdin/stdout 双向中继 |

**通信协议：JSON-RPC 2.0 over stdin/stdout**（非 HTTP，无网络开销）

**消息流：**

```
用户发消息 → WebSocket → relay → CodexService.send_user_message()
→ turn/start RPC → 大模型推理 → turn/item/updated 流式返回
→ WebSocket → 前端渲染
```

- 首次消息自动注入中文系统提示：`"You must respond in Chinese ONLY. You are a Chinese graduate entrance exam math tutor."`
- 支持**远程代理模式**：浏览器生成配对码，本地 PC 运行 `local_agent.py` 连接，AI 操作本地文件系统

---

### 4. 知识体系与学习追踪

| 实体 | Embedding 内容 | 用途 |
|------|----------------|------|
| `knowledge_points` | name + description | 树形知识图谱，掌握度追踪 |
| `learning_materials` | title + type + notes | 资料 → 知识点自动匹配 |
| `study_patterns` | 时段/科目/完成率/心情 JSON | 学习习惯分析，AI 优化建议 |

---

## 整体数据流

```
夸克网盘(WebDAV) → 文件下载 → MinerU解析 → Chunker切片 → Embedding向量化
                                                              ↓
浏览器 ← WebSocket ← FastAPI ← Codex子进程 ← 大模型API    pgvector语义检索
                                              ↓
                                         知识库RAG增强
```

**核心思想：** 将考研资料转化为可语义检索的向量知识库，再通过 Codex Agent 让大模型基于这些资料进行一对一辅导。整个链路从文档解析、知识切片、向量化存储到实时对话，形成完整的 AI 学习闭环。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS + Recharts |
| 后端 | Python FastAPI + WebSocket + JSON-RPC 2.0 |
| AI 引擎 | Codex CLI (OpenAI) + OpenAI Embedding API |
| 数据库 | Supabase (PostgreSQL + pgvector) |
| 文档解析 | MinerU + 自研 Chunker |
| 文件存储 | 夸克网盘 WebDAV |

---

## 快速开始

### 前置条件

1. [Supabase](https://supabase.com) 账号 + 项目
2. [OpenAI API Key](https://platform.openai.com/api-keys)
3. [夸克网盘](https://pan.quark.cn) WebDAV 地址

### 数据库部署

```bash
# 方式A: Supabase Dashboard SQL Editor 执行 supabase/migrations/ 下所有迁移文件
# 方式B: Supabase CLI
supabase link --project-ref <your-project-ref>
supabase db push
```

### Edge Function 部署

```bash
cd supabase
supabase functions deploy generate-embedding
supabase secrets set OPENAI_API_KEY=sk-your-key-here
```

### 后端启动

```bash
cd backend
pip install -r requirements.txt
uvicorn src.main:app --reload
```

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

---

## 项目结构

```
ky-platform/
├── frontend/                    # React + Vite 前端
│   ├── src/
│   │   ├── components/          # AuthGuard, ChatPanel, MainLayout
│   │   ├── contexts/            # AuthContext
│   │   ├── lib/                 # supabase.ts, utils.ts
│   │   └── pages/               # Dashboard, Knowledge, LearningCenter, Materials, Plans, Statistics, Settings, Login
│   └── ...
├── backend/                     # Python FastAPI 后端
│   ├── src/
│   │   ├── routes/              # health, learning, learning_context, process
│   │   └── services/            # chunker, codex_service, embedding, learning_service, mineru_parser, pdf_parser, relay_service, supabase
│   ├── Dockerfile
│   └── docker-compose.yml
├── supabase/                    # Supabase 配置
│   ├── migrations/              # 数据库迁移 (15+)
│   └── functions/               # Edge Functions (ai-chat, generate-embedding, parse-document, webdav-proxy)
├── docs/
│   └── ARCHITECTURE.md          # 产品架构文档
├── local_agent.py               # 远程代理：本地文件系统操作
└── README.md
```
