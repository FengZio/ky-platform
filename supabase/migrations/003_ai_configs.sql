-- ============================================================
-- 003_ai_configs.sql
-- 用户AI供应商配置（替代环境变量，前端可编辑）
-- ============================================================

CREATE TABLE ai_configs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL UNIQUE,          -- 每个用户一条配置
    provider        TEXT DEFAULT 'custom',          -- openai / deepseek / zhipu / ollama / custom
    api_key         TEXT NOT NULL DEFAULT '',
    base_url        TEXT DEFAULT 'https://api.openai.com/v1',
    chat_model      TEXT DEFAULT 'gpt-4o-mini',
    embedding_model TEXT DEFAULT 'text-embedding-3-small',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ai_config"
  ON ai_configs FOR ALL USING (auth.uid() = user_id);

-- Index
CREATE INDEX idx_ai_configs_user ON ai_configs(user_id);

-- Trigger
CREATE TRIGGER set_updated_at_ai_configs
  BEFORE UPDATE ON ai_configs FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Grant API access
GRANT ALL ON ai_configs TO anon, authenticated;
