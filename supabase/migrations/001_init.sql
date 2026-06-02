-- ============================================================
-- 考研AI助手 · 数据库初始化迁移
-- Schema: public (Supabase default)
-- Extensions: uuid-ossp, pgvector
-- ============================================================

-- 1. Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";


-- 2. 考试信息表
-- ============================================================
CREATE TABLE exam_info (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    name        TEXT NOT NULL,
    exam_date   DATE NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- 3. 科目表
-- ============================================================
CREATE TABLE subjects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    name        TEXT NOT NULL,
    code        TEXT,
    color       TEXT DEFAULT '#6366f1',
    icon        TEXT,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- 4. 长计划表
-- ============================================================
CREATE TABLE plans (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL,
    exam_id       UUID REFERENCES exam_info(id) ON DELETE SET NULL,
    subject_id    UUID REFERENCES subjects(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    target_score  DECIMAL(5,1),
    status        TEXT DEFAULT 'planning'
                  CHECK (status IN ('planning','active','completed','paused')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);


-- 5. 计划阶段表
-- ============================================================
CREATE TABLE plan_phases (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    sequence    INT NOT NULL DEFAULT 0,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      TEXT DEFAULT 'pending'
                CHECK (status IN ('pending','active','completed')),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- 6. 知识点表 (树形结构 + 向量)
-- ============================================================
CREATE TABLE knowledge_points (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL,
    subject_id    UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    parent_id     UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    difficulty    INT DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    importance    INT DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    sort_order    INT DEFAULT 0,
    is_mastered   BOOLEAN DEFAULT FALSE,
    mastered_at   TIMESTAMPTZ,
    -- 向量: 向量维度 (由所用模型决定, 常见 1024/1536/3072)
    embedding     VECTOR,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);


-- 7. WebDAV 配置表
-- ============================================================
CREATE TABLE webdav_configs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    name        TEXT NOT NULL DEFAULT '夸克网盘',
    url         TEXT NOT NULL,
    username    TEXT NOT NULL,
    password    TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- 8. 学习资料表 (关联WebDAV + 向量)
-- ============================================================
CREATE TABLE learning_materials (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL,
    knowledge_point_id  UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    subject_id          UUID REFERENCES subjects(id) ON DELETE SET NULL,
    webdav_config_id    UUID REFERENCES webdav_configs(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    type                TEXT NOT NULL
                        CHECK (type IN ('video','document','exercise','note','other')),
    webdav_path         TEXT NOT NULL,
    file_type           TEXT,
    file_size           BIGINT,
    duration_minutes    INT,
    source              TEXT DEFAULT '夸克WebDAV',
    notes               TEXT,
    -- 向量
    embedding           VECTOR,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);


-- 9. 每日目标表
-- ============================================================
CREATE TABLE daily_goals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    plan_id         UUID REFERENCES plans(id) ON DELETE SET NULL,
    date            DATE NOT NULL DEFAULT CURRENT_DATE,
    title           TEXT,
    notes           TEXT,
    completion_rate REAL DEFAULT 0 CHECK (completion_rate BETWEEN 0 AND 1),
    reflection      TEXT,
    mood            INT CHECK (mood BETWEEN 1 AND 5),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);


-- 10. 每日目标项表
-- ============================================================
CREATE TABLE daily_goal_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    daily_goal_id       UUID NOT NULL REFERENCES daily_goals(id) ON DELETE CASCADE,
    knowledge_point_id  UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    material_id         UUID REFERENCES learning_materials(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    description         TEXT,
    estimated_minutes   INT DEFAULT 30,
    actual_minutes      INT,
    status              TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','completed','skipped')),
    sort_order          INT DEFAULT 0,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);


-- 11. 学习记录表
-- ============================================================
CREATE TABLE study_sessions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL,
    goal_item_id        UUID REFERENCES daily_goal_items(id) ON DELETE SET NULL,
    knowledge_point_id  UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    material_id         UUID REFERENCES learning_materials(id) ON DELETE SET NULL,
    start_time          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time            TIMESTAMPTZ,
    duration_minutes    INT,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);


-- 12. 学习模式向量表 (学习行为分析)
-- ============================================================
CREATE TABLE study_patterns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    daily_goal_id   UUID REFERENCES daily_goals(id) ON DELETE CASCADE,
    -- 行为特征向量: [时段分布, 科目分布, 完成率, 时长, 心情, ...] → 1536维
    embedding       VECTOR,
    -- 原始特征快照(JSON)
    features_json   JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 索引
-- ============================================================

-- B-tree 索引
CREATE INDEX idx_exam_info_user       ON exam_info(user_id);
CREATE INDEX idx_subjects_user        ON subjects(user_id);
CREATE INDEX idx_plans_user           ON plans(user_id);
CREATE INDEX idx_plans_exam           ON plans(exam_id);
CREATE INDEX idx_plans_subject        ON plans(subject_id);
CREATE INDEX idx_plan_phases_plan     ON plan_phases(plan_id);
CREATE INDEX idx_kp_user              ON knowledge_points(user_id);
CREATE INDEX idx_kp_subject           ON knowledge_points(subject_id);
CREATE INDEX idx_kp_parent            ON knowledge_points(parent_id);
CREATE INDEX idx_webdav_user          ON webdav_configs(user_id);
CREATE INDEX idx_lm_user              ON learning_materials(user_id);
CREATE INDEX idx_lm_kp                ON learning_materials(knowledge_point_id);
CREATE INDEX idx_lm_subject           ON learning_materials(subject_id);
CREATE INDEX idx_lm_webdav            ON learning_materials(webdav_config_id);
CREATE INDEX idx_dg_user_date         ON daily_goals(user_id, date);
CREATE INDEX idx_dg_plan              ON daily_goals(plan_id);
CREATE INDEX idx_dgi_goal             ON daily_goal_items(daily_goal_id);
CREATE INDEX idx_dgi_kp               ON daily_goal_items(knowledge_point_id);
CREATE INDEX idx_dgi_material         ON daily_goal_items(material_id);
CREATE INDEX idx_ss_user              ON study_sessions(user_id);
CREATE INDEX idx_ss_time              ON study_sessions(start_time);
CREATE INDEX idx_ss_goal_item         ON study_sessions(goal_item_id);
CREATE INDEX idx_sp_user              ON study_patterns(user_id);
CREATE INDEX idx_sp_daily_goal        ON study_patterns(daily_goal_id);

-- pgvector IVFFlat 索引 (近似最近邻检索, lists=表行数/1000)
-- 注意: IVFFlat 需要先有数据再建索引, 此处仅建索引名占位
-- CREATE INDEX idx_kp_embedding ON knowledge_points USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_lm_embedding ON learning_materials USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_sp_embedding ON study_patterns USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);


-- ============================================================
-- 自动更新 updated_at 触发器
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_exam_info
  BEFORE UPDATE ON exam_info FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_plans
  BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_knowledge_points
  BEFORE UPDATE ON knowledge_points FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_webdav_configs
  BEFORE UPDATE ON webdav_configs FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_learning_materials
  BEFORE UPDATE ON learning_materials FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_daily_goals
  BEFORE UPDATE ON daily_goals FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_daily_goal_items
  BEFORE UPDATE ON daily_goal_items FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 向量相似度搜索函数
-- ============================================================

-- 搜索相似知识点 (cosine距离 → 相似度)
CREATE OR REPLACE FUNCTION search_similar_knowledge_points(
    p_user_id     UUID,
    p_embedding   VECTOR,
    p_limit       INT DEFAULT 5,
    p_threshold   REAL DEFAULT 0.7  -- 相似度阈值
)
RETURNS TABLE(
    id           UUID,
    name         TEXT,
    description  TEXT,
    subject_name TEXT,
    similarity   REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        kp.id,
        kp.name,
        kp.description,
        s.name AS subject_name,
        (1 - (kp.embedding <=> p_embedding))::REAL AS similarity
    FROM knowledge_points kp
    JOIN subjects s ON s.id = kp.subject_id
    WHERE kp.user_id = p_user_id
      AND kp.embedding IS NOT NULL
      AND (1 - (kp.embedding <=> p_embedding)) > p_threshold
    ORDER BY kp.embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 自动匹配资料到知识点
CREATE OR REPLACE FUNCTION match_materials_to_knowledge_points(
    p_user_id   UUID,
    p_material_id UUID DEFAULT NULL,  -- NULL = 处理所有未关联的
    p_limit     INT DEFAULT 5
)
RETURNS TABLE(
    material_id   UUID,
    material_title TEXT,
    kp_id         UUID,
    kp_name       TEXT,
    match_score   REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        lm.id AS material_id,
        lm.title AS material_title,
        kp.id AS kp_id,
        kp.name AS kp_name,
        (1 - (lm.embedding <=> kp.embedding))::REAL AS match_score
    FROM learning_materials lm
    CROSS JOIN knowledge_points kp
    WHERE lm.user_id = p_user_id
      AND kp.user_id = p_user_id
      AND lm.embedding IS NOT NULL
      AND kp.embedding IS NOT NULL
      AND lm.knowledge_point_id IS NULL  -- 仅处理未关联的
      AND (p_material_id IS NULL OR lm.id = p_material_id)
    ORDER BY lm.embedding <=> kp.embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 搜索相似学习模式
CREATE OR REPLACE FUNCTION search_similar_study_patterns(
    p_user_id     UUID,
    p_embedding   VECTOR,
    p_limit       INT DEFAULT 5
)
RETURNS TABLE(
    daily_goal_id  UUID,
    date           DATE,
    completion_rate REAL,
    mood           INT,
    reflection     TEXT,
    similarity     REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dg.id AS daily_goal_id,
        dg.date,
        dg.completion_rate,
        dg.mood,
        dg.reflection,
        (1 - (sp.embedding <=> p_embedding))::REAL AS similarity
    FROM study_patterns sp
    JOIN daily_goals dg ON dg.id = sp.daily_goal_id
    WHERE sp.user_id = p_user_id
      AND sp.embedding IS NOT NULL
    ORDER BY sp.embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RLS 策略 (Row Level Security)
-- ============================================================

-- 所有表启用 RLS
ALTER TABLE exam_info           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_phases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_points    ENABLE ROW LEVEL SECURITY;
ALTER TABLE webdav_configs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_goal_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_patterns      ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的数据
CREATE POLICY "Users manage own exam_info"
  ON exam_info FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own subjects"
  ON subjects FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own plans"
  ON plans FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own plan_phases"
  ON plan_phases FOR ALL
  USING (EXISTS (
    SELECT 1 FROM plans WHERE plans.id = plan_phases.plan_id AND plans.user_id = auth.uid()
  ));

CREATE POLICY "Users manage own knowledge_points"
  ON knowledge_points FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own webdav_configs"
  ON webdav_configs FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own learning_materials"
  ON learning_materials FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own daily_goals"
  ON daily_goals FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own daily_goal_items"
  ON daily_goal_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM daily_goals WHERE daily_goals.id = daily_goal_items.daily_goal_id AND daily_goals.user_id = auth.uid()
  ));

CREATE POLICY "Users manage own study_sessions"
  ON study_sessions FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own study_patterns"
  ON study_patterns FOR ALL USING (auth.uid() = user_id);


-- ============================================================
-- 种子数据: 考研常见科目
-- ============================================================
-- 注: 种子数据不设 user_id, 作为系统预置模板供用户复制

-- 此处为参考, 实际通过应用层插入
-- INSERT INTO subjects (user_id, name, code, color, sort_order) VALUES
--   ('<user_id>', '政治',       'politics',    '#f43f5e', 1),
--   ('<user_id>', '英语一',     'english1',    '#3b82f6', 2),
--   ('<user_id>', '英语二',     'english2',    '#3b82f6', 3),
--   ('<user_id>', '数学一',     'math1',       '#10b981', 4),
--   ('<user_id>', '数学二',     'math2',       '#10b981', 5),
--   ('<user_id>', '数学三',     'math3',       '#10b981', 6),
--   ('<user_id>', '专业课一',   'specialized1', '#8b5cf6', 7),
--   ('<user_id>', '专业课二',   'specialized2', '#8b5cf6', 8);


-- ============================================================
-- Grant API 访问 (Supabase Data API)
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
