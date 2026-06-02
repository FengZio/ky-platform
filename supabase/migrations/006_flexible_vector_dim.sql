-- ============================================================
-- 006: 向量列改为无维度约束 (兼容不同 embedding 模型输出)
-- ============================================================
-- 原来 VECTOR(1536) 硬编码了 text-embedding-3-small 的维度,
-- 但不同模型输出维度不同 (如 bge-large-zh-v1.5=1024, embedding-3=1024),
-- 改为 VECTOR (无约束) 以适配任意维度的向量。

-- 1. 列类型变更
ALTER TABLE knowledge_points  ALTER COLUMN embedding TYPE VECTOR;
ALTER TABLE learning_materials ALTER COLUMN embedding TYPE VECTOR;
ALTER TABLE study_patterns     ALTER COLUMN embedding TYPE VECTOR;

-- 2. 更新函数签名 (参数去掉维度约束)
CREATE OR REPLACE FUNCTION search_similar_knowledge_points(
    p_user_id     UUID,
    p_embedding   VECTOR,
    p_limit       INT DEFAULT 5,
    p_threshold   REAL DEFAULT 0.7
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

-- 3. 注意: 如果列上有 IVFFlat 索引, 需要重建:
--    DROP INDEX IF EXISTS idx_kp_embedding;
--    CREATE INDEX idx_kp_embedding ON knowledge_points
--      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--    (仅当该索引存在时需要, 否则忽略)
-- 4. 重建资料→知识点自动匹配函数 (ALTER COLUMN 后需重新定义)
DROP FUNCTION IF EXISTS match_materials_to_knowledge_points CASCADE;
CREATE OR REPLACE FUNCTION match_materials_to_knowledge_points(
    p_user_id     UUID,
    p_material_id UUID DEFAULT NULL,
    p_limit       INT DEFAULT 5
)
RETURNS TABLE(
    material_id    UUID,
    material_title TEXT,
    kp_id          UUID,
    kp_name        TEXT,
    match_score    REAL
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
      AND lm.knowledge_point_id IS NULL
      AND (p_material_id IS NULL OR lm.id = p_material_id)
    ORDER BY lm.embedding <=> kp.embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;