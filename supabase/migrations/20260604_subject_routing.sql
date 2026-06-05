-- ============================================================
-- 按学科分库路由：向量检索 RPC 增加 p_subject_id 过滤
-- ============================================================

-- 避免默认参数重载导致 Supabase RPC 调用歧义，先清理旧/新签名。
DROP FUNCTION IF EXISTS search_chunks_by_vector(VECTOR, UUID[], INT, REAL) CASCADE;
DROP FUNCTION IF EXISTS search_chunks_by_vector(VECTOR, UUID[], INT, REAL, UUID) CASCADE;
DROP FUNCTION IF EXISTS search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL) CASCADE;
DROP FUNCTION IF EXISTS search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) CASCADE;
DROP FUNCTION IF EXISTS search_kps_by_vector(VECTOR, UUID[], INT, REAL) CASCADE;
DROP FUNCTION IF EXISTS search_kps_by_vector(VECTOR, UUID[], INT, REAL, UUID) CASCADE;
DROP FUNCTION IF EXISTS find_similar_questions(UUID, INT, REAL) CASCADE;
DROP FUNCTION IF EXISTS find_similar_questions(UUID, INT, REAL, UUID) CASCADE;

CREATE OR REPLACE FUNCTION search_chunks_by_vector(
    p_query_embedding VECTOR,
    p_material_ids    UUID[] DEFAULT NULL,
    p_top_k           INT DEFAULT 5,
    p_min_score       REAL DEFAULT 0.3,
    p_subject_id      UUID DEFAULT NULL
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
      AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
      AND (p_subject_id IS NULL OR lm.subject_id = p_subject_id)
      AND (1 - (mc.embedding <=> p_query_embedding))::REAL >= p_min_score
    ORDER BY mc.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION search_chunks_hybrid(
    p_query_embedding VECTOR,
    p_knowledge_tags  TEXT[] DEFAULT NULL,
    p_material_ids    UUID[] DEFAULT NULL,
    p_top_k           INT DEFAULT 5,
    p_min_score       REAL DEFAULT 0.3,
    p_subject_id      UUID DEFAULT NULL
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
          AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
          AND (p_subject_id IS NULL OR lm.subject_id = p_subject_id)
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
          AND (p_material_ids IS NULL OR lm.id = ANY(p_material_ids))
          AND (p_subject_id IS NULL OR lm.subject_id = p_subject_id)
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

CREATE OR REPLACE FUNCTION search_kps_by_vector(
    p_query_embedding VECTOR,
    p_kp_ids          UUID[] DEFAULT NULL,
    p_top_k           INT DEFAULT 5,
    p_min_score       REAL DEFAULT 0.3,
    p_subject_id      UUID DEFAULT NULL
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
      AND (p_kp_ids IS NULL OR kp.id = ANY(p_kp_ids))
      AND (p_subject_id IS NULL OR kp.subject_id = p_subject_id)
      AND (1 - (kp.embedding <=> p_query_embedding))::REAL >= p_min_score
    ORDER BY kp.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION find_similar_questions(
    p_chunk_id    UUID,
    p_limit       INT DEFAULT 5,
    p_min_score   REAL DEFAULT 0.6,
    p_subject_id  UUID DEFAULT NULL
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
DECLARE
    src_embedding  VECTOR;
    src_tags       TEXT[];
    src_material   UUID;
BEGIN
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
          AND mc.knowledge_points && src_tags
          AND (p_subject_id IS NULL OR lm.subject_id = p_subject_id)
          AND (1 - (mc.embedding <=> src_embedding))::REAL >= p_min_score
        ORDER BY score DESC
        LIMIT p_limit * 2
    ),
    vector_only AS (
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
          AND (p_subject_id IS NULL OR lm.subject_id = p_subject_id)
          AND (1 - (mc.embedding <=> src_embedding))::REAL >= p_min_score
          AND NOT EXISTS (
            SELECT 1 FROM tag_filtered tf WHERE tf.id = mc.id
          )
        ORDER BY score DESC
        LIMIT p_limit
    ),
    combined AS (
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
        CASE WHEN method = 'tag_vector' THEN 0 ELSE 1 END,
        score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL, UUID) TO anon, authenticated, service_role;
