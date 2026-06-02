-- ============================================================
-- 017: 对话上下文向量检索函数
-- ============================================================

-- 根据用户问题向量，检索最相关的资料分块和知识点
CREATE OR REPLACE FUNCTION search_chat_context(
    p_query_embedding VECTOR,
    p_material_ids    UUID[] DEFAULT NULL,
    p_kp_ids          UUID[] DEFAULT NULL,
    p_chunk_limit     INT DEFAULT 5,
    p_kp_limit        INT DEFAULT 3,
    p_min_score       REAL DEFAULT 0.5
)
RETURNS TABLE(
    source_type  TEXT,       -- 'chunk' | 'knowledge_point'
    source_id    UUID,
    source_title TEXT,
    content      TEXT,
    score        REAL
) AS \$\$
BEGIN
    RETURN QUERY
    
    -- 1. 资料分块检索 (如果指定了 material_ids 则限定范围)
    SELECT
        'chunk'::TEXT AS source_type,
        mc.id AS source_id,
        lm.title AS source_title,
        mc.content,
        (1 - (mc.embedding <=> p_query_embedding))::REAL AS score
    FROM material_chunks mc
    JOIN learning_materials lm ON lm.id = mc.material_id
    WHERE mc.embedding IS NOT NULL
      AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
      AND (1 - (mc.embedding <=> p_query_embedding))::REAL >= p_min_score
    ORDER BY mc.embedding <=> p_query_embedding
    LIMIT p_chunk_limit

    UNION ALL

    -- 2. 知识点检索
    SELECT
        'knowledge_point'::TEXT AS source_type,
        kp.id AS source_id,
        kp.name AS source_title,
        COALESCE(kp.description, kp.name) AS content,
        (1 - (kp.embedding <=> p_query_embedding))::REAL AS score
    FROM knowledge_points kp
    WHERE kp.embedding IS NOT NULL
      AND (p_kp_ids IS NULL OR kp.id = ANY(p_kp_ids))
      AND (1 - (kp.embedding <=> p_query_embedding))::REAL >= p_min_score
    ORDER BY kp.embedding <=> p_query_embedding
    LIMIT p_kp_limit

    ORDER BY score DESC;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_chat_context TO anon, authenticated;
