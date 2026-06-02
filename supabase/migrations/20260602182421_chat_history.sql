-- ============================================================
-- 016: 对话记录表 (Chat History)
-- ============================================================

CREATE TABLE chat_conversations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    title       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id     UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL,
    role                TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content             TEXT NOT NULL,
    context_kp_ids      UUID[] DEFAULT '{}',
    context_material_ids UUID[] DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_chat_conv_user ON chat_conversations(user_id);
CREATE INDEX idx_chat_conv_updated ON chat_conversations(updated_at DESC);
CREATE INDEX idx_chat_msg_conv ON chat_messages(conversation_id);
CREATE INDEX idx_chat_msg_user ON chat_messages(user_id);
CREATE INDEX idx_chat_msg_created ON chat_messages(created_at);

-- Auto updated_at
CREATE TRIGGER set_updated_at_chat_conversations
  BEFORE UPDATE ON chat_conversations FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chat_conversations"
  ON chat_conversations FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own chat_messages"
  ON chat_messages FOR ALL USING (auth.uid() = user_id);

GRANT ALL ON chat_conversations TO anon, authenticated;
GRANT ALL ON chat_messages TO anon, authenticated;
