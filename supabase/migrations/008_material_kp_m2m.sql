-- ============================================================
-- 008: 材料-知识点多对多关联表
-- ============================================================
-- 摆脱 learning_materials.knowledge_point_id 的一对一限制，
-- 文档切块后每块可匹配不同知识点。

-- 1. 多对多关联表
CREATE TABLE material_knowledge_points (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
    kp_id       UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    chunk_id    UUID REFERENCES material_chunks(id) ON DELETE SET NULL,
    match_score REAL,
    source      TEXT DEFAULT 'manual',  -- manual / auto / ai_review
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(material_id, kp_id)
);

COMMENT ON TABLE material_knowledge_points IS '材料与知识点多对多关联，每块可匹配不同知识点';

CREATE INDEX idx_mkp_material ON material_knowledge_points(material_id);
CREATE INDEX idx_mkp_kp ON material_knowledge_points(kp_id);

-- RLS
ALTER TABLE material_knowledge_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own material_kp"
  ON material_knowledge_points FOR ALL
  USING (EXISTS (
    SELECT 1 FROM learning_materials lm
    WHERE lm.id = material_knowledge_points.material_id AND lm.user_id = auth.uid()
  ));

GRANT ALL ON material_knowledge_points TO anon, authenticated;

-- 2. 迁移现有一对一关系到多对多
INSERT INTO material_knowledge_points (material_id, kp_id, source)
SELECT id, knowledge_point_id, 'manual'
FROM learning_materials
WHERE knowledge_point_id IS NOT NULL
ON CONFLICT (material_id, kp_id) DO NOTHING;

-- 3. 更新块级匹配函数：改用 junction table 做去重
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
    WITH ranked AS (
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
          AND NOT EXISTS (
            SELECT 1 FROM material_knowledge_points mkp
            WHERE mkp.material_id = lm.id AND mkp.kp_id = kp.id
          )
          AND (p_material_id IS NULL OR lm.id = p_material_id)
          AND (1 - (mc.embedding <=> kp.embedding))::REAL >= p_min_score
        ORDER BY mc.material_id, kp.id, mc.embedding <=> kp.embedding
    )
    SELECT * FROM ranked
    ORDER BY match_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 一键自动关联函数 (匹配度 >= threshold 的直接写入关联表)
CREATE OR REPLACE FUNCTION auto_link_materials_to_kps(
    p_user_id   UUID,
    p_min_score REAL DEFAULT 0.65
)
RETURNS TABLE(linked_count INT) AS $$
DECLARE
    v_count INT;
BEGIN
    WITH matches AS (
        SELECT DISTINCT ON (mc.material_id, kp.id)
            lm.id AS mat_id,
            kp.id AS kp_id,
            mc.id AS chunk_id,
            (1 - (mc.embedding <=> kp.embedding))::REAL AS score
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        CROSS JOIN knowledge_points kp
        WHERE lm.user_id = p_user_id
          AND kp.user_id = p_user_id
          AND mc.embedding IS NOT NULL
          AND kp.embedding IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM material_knowledge_points mkp
            WHERE mkp.material_id = lm.id AND mkp.kp_id = kp.id
          )
          AND (1 - (mc.embedding <=> kp.embedding))::REAL >= p_min_score
        ORDER BY mc.material_id, kp.id, mc.embedding <=> kp.embedding
    )
    INSERT INTO material_knowledge_points (material_id, kp_id, chunk_id, match_score, source)
    SELECT mat_id, kp_id, chunk_id, score, 'auto'
    FROM matches
    ON CONFLICT (material_id, kp_id) DO NOTHING;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    linked_count := v_count;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
