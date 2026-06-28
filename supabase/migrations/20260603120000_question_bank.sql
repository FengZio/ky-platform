-- ============================================================
-- 018: 题库表 + 日目标关联题目
-- ============================================================

-- 1. 题库表
CREATE TABLE question_bank (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL,
    content_hash            TEXT NOT NULL,
    parent_question_id      UUID,
    plan_id                 UUID REFERENCES plans(id) ON DELETE SET NULL,
    phase_id                UUID REFERENCES plan_phases(id) ON DELETE SET NULL,
    knowledge_point_ids     UUID[] DEFAULT '{}',
    material_id             UUID REFERENCES learning_materials(id) ON DELETE SET NULL,
    type                    TEXT NOT NULL CHECK (type IN ('choice','short_answer','calculation','essay','true_false')),
    difficulty              SMALLINT NOT NULL DEFAULT 3 CHECK (difficulty >= 1 AND difficulty <= 5),
    content                 TEXT NOT NULL,
    options                 JSONB DEFAULT '[]'::JSONB,
    answer                  TEXT NOT NULL,
    explanation             TEXT,
    source                  TEXT NOT NULL DEFAULT 'ai_generated' CHECK (source IN ('ai_generated','manual')),
    source_conversation_id  UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    tags                    TEXT[] DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 去重约束：同一用户不存重复题
ALTER TABLE question_bank ADD CONSTRAINT uq_qb_user_hash UNIQUE (user_id, content_hash);

-- 索引
CREATE INDEX idx_qb_user ON question_bank(user_id);
CREATE INDEX idx_qb_type ON question_bank(type);
CREATE INDEX idx_qb_difficulty ON question_bank(difficulty);
CREATE INDEX idx_qb_created ON question_bank(created_at DESC);
CREATE INDEX idx_qb_kp_ids ON question_bank USING GIN (knowledge_point_ids);
CREATE INDEX idx_qb_tags ON question_bank USING GIN (tags);
CREATE INDEX idx_qb_parent ON question_bank(parent_question_id);

-- Auto updated_at
CREATE TRIGGER set_updated_at_question_bank
  BEFORE UPDATE ON question_bank FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own questions"
  ON question_bank FOR ALL USING (auth.uid() = user_id);

GRANT ALL ON question_bank TO anon, authenticated;


-- 2. daily_goal_items 新增 question_id 字段
ALTER TABLE daily_goal_items ADD COLUMN question_id UUID REFERENCES question_bank(id) ON DELETE SET NULL;
CREATE INDEX idx_dgi_question ON daily_goal_items(question_id);
