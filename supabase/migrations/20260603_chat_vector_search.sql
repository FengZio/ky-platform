-- ============================================================
-- 016: 聊天向量搜索 RPC — 供后端 & MCP Server 调用
--       用 pgvector <=> 算子实现高效语义检索
--       user_id=NULL 时不限用户（admin 模式）
-- ============================================================

-- 搜索资料分块 (按用户消息向量)
CREATE OR REPLACE FUNCTION search_chunks_by_vector(
    p_query_embedding VECTOR,
    p_user_id         UUID DEFAULT NULL,
    p_material_ids    UUID[] DEFAULT NULL,
    p_top_k           INT DEFAULT 5,
    p_min_score       REAL DEFAULT 0.3
)
RETURNS TABLE(
    chunk_id       UUID,
    chunk_content  TEXT,
    material_id    UUID,
    material_title TEXT,
    match_score    REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mc.id AS chunk_id,
        mc.content AS chunk_content,
        lm.id AS material_id,
        lm.title AS material_title,
        (1 - (mc.embedding <=> p_query_embedding))::REAL AS match_score
    FROM material_chunks mc
    JOIN learning_materials lm ON lm.id = mc.material_id
    WHERE mc.embedding IS NOT NULL
      AND (p_user_id IS NULL OR lm.user_id = p_user_id)
      AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
      AND (1 - (mc.embedding <=> p_query_embedding))::REAL >= p_min_score
    ORDER BY mc.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 搜索知识点 (按用户消息向量)
CREATE OR REPLACE FUNCTION search_kps_by_vector(
    p_query_embedding VECTOR,
    p_user_id         UUID DEFAULT NULL,
    p_kp_ids          UUID[] DEFAULT NULL,
    p_top_k           INT DEFAULT 5,
    p_min_score       REAL DEFAULT 0.3
)
RETURNS TABLE(
    kp_id        UUID,
    kp_name      TEXT,
    description  TEXT,
    match_score  REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        kp.id AS kp_id,
        kp.name AS kp_name,
        kp.description,
        (1 - (kp.embedding <=> p_query_embedding))::REAL AS match_score
    FROM knowledge_points kp
    WHERE kp.embedding IS NOT NULL
      AND (p_user_id IS NULL OR kp.user_id = p_user_id)
      AND (p_kp_ids IS NULL OR kp.id = ANY(p_kp_ids))
      AND (1 - (kp.embedding <=> p_query_embedding))::REAL >= p_min_score
    ORDER BY kp.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 搜索资料分块 (按标签 + 向量混合)
CREATE OR REPLACE FUNCTION search_chunks_hybrid(
    p_query_embedding VECTOR,
    p_user_id         UUID DEFAULT NULL,
    p_knowledge_tags  TEXT[] DEFAULT NULL,
    p_material_ids    UUID[] DEFAULT NULL,
    p_top_k           INT DEFAULT 5,
    p_min_score       REAL DEFAULT 0.3
)
RETURNS TABLE(
    chunk_id        UUID,
    chunk_content   TEXT,
    material_id     UUID,
    material_title  TEXT,
    knowledge_tags  TEXT[],
    match_score     REAL,
    match_method    TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH tag_filtered AS (
        SELECT
            mc.id,
            mc.content,
            lm.id AS material_id,
            lm.title AS material_title,
            mc.knowledge_points,
            (1 - (mc.embedding <=> p_query_embedding))::REAL AS score,
            'tag_vector'::TEXT AS method
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        WHERE mc.embedding IS NOT NULL
          AND (p_user_id IS NULL OR lm.user_id = p_user_id)
          AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
          AND (p_knowledge_tags IS NULL OR mc.knowledge_points && p_knowledge_tags)
          AND (1 - (mc.embedding <=> p_query_embedding))::REAL >= p_min_score
        ORDER BY score DESC
        LIMIT p_top_k * 2
    ),
    vector_only AS (
        SELECT
            mc.id,
            mc.content,
            lm.id AS material_id,
            lm.title AS material_title,
            mc.knowledge_points,
            (1 - (mc.embedding <=> p_query_embedding))::REAL AS score,
            'vector_only'::TEXT AS method
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        WHERE mc.embedding IS NOT NULL
          AND (p_user_id IS NULL OR lm.user_id = p_user_id)
          AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
          AND (1 - (mc.embedding <=> p_query_embedding))::REAL >= p_min_score
          AND NOT EXISTS (
            SELECT 1 FROM tag_filtered tf WHERE tf.id = mc.id
          )
        ORDER BY score DESC
        LIMIT p_top_k
    )
    SELECT * FROM tag_filtered
    UNION ALL
    SELECT * FROM vector_only
    ORDER BY
        CASE WHEN method = 'tag_vector' THEN 0 ELSE 1 END,
        score DESC
    LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute
GRANT EXECUTE ON FUNCTION search_chunks_by_vector TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_kps_by_vector TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_chunks_hybrid TO anon, authenticated, service_role;
