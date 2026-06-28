-- Fix UNION ORDER BY expression in hybrid chunk search RPCs.
-- PostgreSQL only allows UNION-level ORDER BY to reference output columns.

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
    ),
    combined AS (
        SELECT * FROM tag_filtered
        UNION ALL
        SELECT * FROM vector_only
    )
    SELECT
        c.id,
        c.content,
        c.material_id,
        c.material_title,
        c.knowledge_points,
        c.score,
        c.method
    FROM combined c
    ORDER BY
        CASE WHEN c.method = 'tag_vector' THEN 0 ELSE 1 END,
        c.score DESC
    LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION search_chunks_hybrid(
    p_query_embedding VECTOR,
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
    SELECT *
    FROM search_chunks_hybrid(
        p_query_embedding,
        p_knowledge_tags,
        p_material_ids,
        p_top_k,
        p_min_score,
        NULL::UUID
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL) TO anon, authenticated, service_role;
