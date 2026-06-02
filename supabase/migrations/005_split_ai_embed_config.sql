-- ============================================================
-- 005: 拆分 AI 对话配置与向量模型配置
-- ============================================================
-- 新增 embed_api_key / embed_base_url 独立字段,
-- 重命名 embedding_model → embed_model, 保持向后兼容。

-- 1. 新增向量专属 API Key (NULL = 回退到共享 api_key)
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS embed_api_key TEXT;

COMMENT ON COLUMN ai_configs.embed_api_key
  IS '向量模型专属 API Key, 为空时使用共享 api_key';

-- 2. 新增向量专属 Base URL (NULL = 回退到共享 base_url)
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS embed_base_url TEXT;

COMMENT ON COLUMN ai_configs.embed_base_url
  IS '向量模型专属 Base URL, 为空时使用共享 base_url';

-- 3. 重命名 embedding_model → embed_model (与 chat_model 命名一致)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_configs' AND column_name='embedding_model') THEN
    ALTER TABLE ai_configs RENAME COLUMN embedding_model TO embed_model;
  END IF;
END $$;

COMMENT ON COLUMN ai_configs.embed_model
  IS '向量模型名称 (如 text-embedding-3-small)';

-- ============================================================
-- 字段分工说明:
--   api_key / base_url / chat_model → AI 对话 (ai-chat)
--   embed_api_key / embed_base_url / embed_model → 向量化 (generate-embedding)
--   embed_api_key / embed_base_url 为空时 → 回退到 api_key / base_url
-- ============================================================