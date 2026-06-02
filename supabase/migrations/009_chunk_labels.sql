-- ============================================================
-- 009: chunk_type + knowledge_points 标签化
-- ============================================================
-- 让每个 chunk 知道自己是什么类型、关联哪些知识点,
-- 支持按知识点标签精准筛选, 不再仅依赖向量模糊匹配。

-- 1. 添加字段
ALTER TABLE material_chunks
  ADD COLUMN IF NOT EXISTS chunk_type TEXT DEFAULT 'question',
  ADD COLUMN IF NOT EXISTS knowledge_points TEXT[] DEFAULT '{}';

COMMENT ON COLUMN material_chunks.chunk_type IS 'chunk 类型: knowledge (知识点讲解) / question (题目+解析)';
COMMENT ON COLUMN material_chunks.knowledge_points IS '关联的知识点标签数组, 如 {单链表,快慢指针}';

-- 2. 索引: 按知识点标签快速筛查
CREATE INDEX IF NOT EXISTS idx_chunks_kp ON material_chunks USING gin (knowledge_points);

-- 3. 更新匹配函数: 优先精确标签匹配, 其次向量匹配
DROP FUNCTION IF EXISTS match_materials_to_knowledge_points CASCADE;
CREATE OR REPLACE FUNCTION match_materials_to_knowledge_points(
    p_user_id     UUID,
    p_material_id UUID DEFAULT NULL,
    p_limit       INT DEFAULT 500,
    p_min_score   REAL DEFAULT 0.5
)
RETURNS TABLE(
    material_id    UUID,
    material_title TEXT,
    chunk_id       UUID,
    chunk_content  TEXT,
    kp_id          UUID,
    kp_name        TEXT,
    match_score    REAL
) AS $$
BEGIN
    RETURN QUERY
    WITH tag_match AS (
        -- 标签精确匹配: knowledge_points 数组包含知识点名 → score=1.0
        SELECT DISTINCT ON (mc.material_id, kp.id)
            lm.id AS material_id,
            lm.title AS material_title,
            mc.id AS chunk_id,
            mc.content AS chunk_content,
            kp.id AS kp_id,
            kp.name AS kp_name,
            1.0::REAL AS match_score
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        JOIN knowledge_points kp ON kp.user_id = p_user_id
            AND kp.name = ANY(mc.knowledge_points)
        WHERE lm.user_id = p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM material_knowledge_points mkp
            WHERE mkp.material_id = lm.id AND mkp.kp_id = kp.id
          )
          AND (p_material_id IS NULL OR lm.id = p_material_id)
        ORDER BY mc.material_id, kp.id
    ),
    vector_match AS (
        -- 向量匹配: 无标签时回退到向量余弦相似度
        SELECT DISTINCT ON (mc.material_id, kp.id)
            lm.id AS material_id,
            lm.title AS material_title,
            mc.id AS chunk_id,
            mc.content AS chunk_content,
            kp.id AS kp_id,
            kp.name AS kp_name,
            (1 - (mc.embedding <=> kp.embedding))::REAL AS match_score
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        CROSS JOIN knowledge_points kp
        WHERE lm.user_id = p_user_id
          AND kp.user_id = p_user_id
          AND mc.embedding IS NOT NULL
          AND kp.embedding IS NOT NULL
          AND (1 - (mc.embedding <=> kp.embedding))::REAL >= p_min_score
          AND NOT EXISTS (
            SELECT 1 FROM material_knowledge_points mkp
            WHERE mkp.material_id = lm.id AND mkp.kp_id = kp.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM tag_match tm
            WHERE tm.material_id = lm.id AND tm.kp_id = kp.id
          )
          AND (p_material_id IS NULL OR lm.id = p_material_id)
        ORDER BY mc.material_id, kp.id, mc.embedding <=> kp.embedding
    )
    SELECT * FROM tag_match
    UNION ALL
    SELECT * FROM vector_match
    ORDER BY match_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;