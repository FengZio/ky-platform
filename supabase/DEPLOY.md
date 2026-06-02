# Edge Functions 部署指南

## 环境变量说明

所有 Edge Function 共用一个 `OPENAI_API_KEY`。如使用非 OpenAI 官方端点，额外设置 `OPENAI_BASE_URL`。

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENAI_API_KEY` | API 密钥 **(必填)** | - |
| `OPENAI_BASE_URL` | API 端点地址 | `https://api.openai.com/v1` |
| `EMBEDDING_MODEL` | 向量模型 (generate-embedding) | `text-embedding-3-small` |
| `CHAT_MODEL` | 对话模型 (ai-chat) | `gpt-4o-mini` |

## 常见供应商配置

```bash
# OpenAI 官方
supabase secrets set OPENAI_API_KEY=sk-xxx

# DeepSeek (国产，便宜)
supabase secrets set OPENAI_API_KEY=sk-xxx
supabase secrets set OPENAI_BASE_URL=https://api.deepseek.com/v1
supabase secrets set EMBEDDING_MODEL=text-embedding-3-small  # DeepSeek 无 embedding，需用 OpenAI
supabase secrets set CHAT_MODEL=deepseek-chat

# 智谱AI (GLM)
supabase secrets set OPENAI_API_KEY=xxx.xxx
supabase secrets set OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
supabase secrets set EMBEDDING_MODEL=embedding-3
supabase secrets set CHAT_MODEL=glm-4-flash

# 阿里百炼 (通义千问)
supabase secrets set OPENAI_API_KEY=sk-xxx
supabase secrets set OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
supabase secrets set EMBEDDING_MODEL=text-embedding-v4
supabase secrets set CHAT_MODEL=qwen-plus

# Ollama 本地 (免费)
supabase secrets set OPENAI_API_KEY=ollama
supabase secrets set OPENAI_BASE_URL=http://your-ip:11434/v1
supabase secrets set EMBEDDING_MODEL=nomic-embed-text
supabase secrets set CHAT_MODEL=qwen2.5:7b

# 硅基流动 (SiliconFlow，免费额度)
supabase secrets set OPENAI_API_KEY=sk-xxx
supabase secrets set OPENAI_BASE_URL=https://api.siliconflow.cn/v1
supabase secrets set EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
supabase secrets set CHAT_MODEL=Qwen/Qwen2.5-7B-Instruct
```

## 部署步骤

```bash
# 1. 安装 CLI & 登录
npm install -g supabase
supabase login

# 2. 链接项目
cd E:\ky-platform
supabase link --project-ref cyaekzaljityychwrcxp

# 3. 设置密钥 (选一个供应商)
supabase secrets set OPENAI_API_KEY=sk-your-key

# 4. 部署全部函数
supabase functions deploy webdav-proxy
supabase functions deploy generate-embedding
supabase functions deploy ai-chat

# 5. 验证
curl "https://cyaekzaljityychwrcxp.supabase.co/functions/v1/webdav-proxy?path=/" \
  -H "Authorization: Bearer <jwt>"
```
