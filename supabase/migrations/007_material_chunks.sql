-- ============================================================
-- 007: 资料文本分块表 + 块级向量匹配
-- ============================================================
-- 解决整本书一个向量粒度太粗的问题:
--   整书 → N 个 ~500 字分块 → N 个向量 → 精确匹配到知识点

-- 1. 资料分块表
CREATE TABLE IF NOT EXISTS material_chunks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id UUID NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content     TEXT NOT NULL,
    embedding   VECTOR,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(material_id, chunk_index)
);

-- COMMENT ON TABLE material_chunks IS '资料文本分块, 每块 ~500 字独立向量化';

-- Index
CREATE INDEX IF NOT EXISTS idx_chunks_material ON material_chunks(material_id);

-- RLS
ALTER TABLE material_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own chunks"
  ON material_chunks FOR ALL
  USING (EXISTS (
    SELECT 1 FROM learning_materials lm
    WHERE lm.id = material_chunks.material_id AND lm.user_id = auth.uid()
  ));

GRANT ALL ON material_chunks TO anon, authenticated;

-- 2. 块级匹配函数 (替代原来的整书匹配)
DROP FUNCTION IF EXISTS match_materials_to_knowledge_points CASCADE;
CREATE OR REPLACE FUNCTION match_materials_to_knowledge_points(
    p_user_id     UUID,
    p_material_id UUID DEFAULT NULL,
    p_limit       INT DEFAULT 500
)
RETURNS TABLE(
    material_id    UUID,
    material_title TEXT,
    chunk_content  TEXT,
    kp_id          UUID,
    kp_name        TEXT,
    match_score    REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        lm.id AS material_id,
        lm.title AS material_title,
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
      AND lm.knowledge_point_id IS NULL
      AND (p_material_id IS NULL OR lm.id = p_material_id)
    ORDER BY mc.embedding <=> kp.embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 清理资料旧向量 (后续由 chunks 接管)
-- 保留 learning_materials.embedding 列做元数据向量 (标题+类型),
-- chunks 做正文级别的精确匹配。