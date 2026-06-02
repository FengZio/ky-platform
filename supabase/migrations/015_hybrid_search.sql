-- ============================================================
-- 015: 混合检索 — 举一反三 (标签过滤 + 向量排序)
-- ============================================================

-- 根据一个 chunk 找相似题目
CREATE OR REPLACE FUNCTION find_similar_questions(
    p_chunk_id    UUID,
    p_limit       INT DEFAULT 5,
    p_min_score   REAL DEFAULT 0.6
)
RETURNS TABLE(
    chunk_id        UUID,
    chunk_content   TEXT,
    material_id     UUID,
    material_title  TEXT,
    knowledge_tags  TEXT[],
    match_score     REAL,
    match_method    TEXT   -- 'tag_vector' | 'vector_only'
) AS $$
DECLARE
    src_embedding  VECTOR;
    src_tags       TEXT[];
    src_material   UUID;
BEGIN
    -- 获取源 chunk 信息
    SELECT mc.embedding, mc.knowledge_points, mc.material_id
    INTO src_embedding, src_tags, src_material
    FROM material_chunks mc
    WHERE mc.id = p_chunk_id;

    IF src_embedding IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT[], NULL::REAL, NULL::TEXT WHERE FALSE;
        RETURN;
    END IF;

    RETURN QUERY
    WITH tag_filtered AS (
        -- 标签交集过滤: 共享至少一个知识点标签的 chunk
        SELECT
            mc.id,
            mc.content,
            mc.material_id,
            lm.title AS material_title,
            mc.knowledge_points,
            (1 - (mc.embedding <=> src_embedding))::REAL AS score,
            'tag_vector'::TEXT AS method
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        WHERE mc.id != p_chunk_id
          AND mc.embedding IS NOT NULL
          AND mc.knowledge_points IS NOT NULL
          AND src_tags IS NOT NULL
          AND mc.knowledge_points && src_tags  -- 数组交集
          AND (1 - (mc.embedding <=> src_embedding))::REAL >= p_min_score
        ORDER BY score DESC
        LIMIT p_limit * 2
    ),
    vector_only AS (
        -- 向量兜底: 标签不匹配但向量相似的 (跨知识点发现)
        SELECT
            mc.id,
            mc.content,
            mc.material_id,
            lm.title AS material_title,
            mc.knowledge_points,
            (1 - (mc.embedding <=> src_embedding))::REAL AS score,
            'vector_only'::TEXT AS method
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        WHERE mc.id != p_chunk_id
          AND mc.embedding IS NOT NULL
          AND (1 - (mc.embedding <=> src_embedding))::REAL >= p_min_score
          AND NOT EXISTS (
            SELECT 1 FROM tag_filtered tf WHERE tf.id = mc.id
          )
        ORDER BY score DESC
        LIMIT p_limit
    ),
    combined AS (
        -- tag_vector 优先，同材料去重(每材料最多2个)
        SELECT * FROM tag_filtered
        UNION ALL
        SELECT * FROM vector_only
    ),
    ranked AS (
        SELECT DISTINCT ON (c.id)
            c.id, c.content, c.material_id, c.material_title, c.knowledge_points, c.score, c.method
        FROM combined c
        ORDER BY c.id, c.score DESC
    )
    SELECT *
    FROM ranked
    ORDER BY
        CASE WHEN method = 'tag_vector' THEN 0 ELSE 1 END,  -- tag 匹配优先
        score DESC
    LIMIT p_limit;
END;
$$
 LANGUAGE plpgsql SECURITY DEFINER;
