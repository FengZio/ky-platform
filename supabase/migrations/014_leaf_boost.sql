-- ============================================================
-- 014: 向量匹配优化 — 叶子知识点加权 + 提高阈值
-- ============================================================

DROP FUNCTION IF EXISTS match_materials_to_knowledge_points CASCADE;
CREATE OR REPLACE FUNCTION match_materials_to_knowledge_points(
    p_material_id UUID DEFAULT NULL,
    p_limit       INT DEFAULT 500,
    p_min_score   REAL DEFAULT 0.6
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
        JOIN knowledge_points kp ON kp.name = ANY(mc.knowledge_points)
        WHERE NOT EXISTS (
            SELECT 1 FROM material_knowledge_points mkp
            WHERE mkp.material_id = lm.id AND mkp.kp_id = kp.id
        )
          AND (p_material_id IS NULL OR lm.id = p_material_id)
        ORDER BY mc.material_id, kp.id
    ),
    vector_match AS (
        SELECT DISTINCT ON (mc.material_id, kp.id)
            lm.id AS material_id,
            lm.title AS material_title,
            mc.id AS chunk_id,
            mc.content AS chunk_content,
            kp.id AS kp_id,
            kp.name AS kp_name,
            (((1 - (mc.embedding <=> kp.embedding))::REAL
             + CASE WHEN NOT EXISTS (
                 SELECT 1 FROM knowledge_points child WHERE child.parent_id = kp.id
             ) THEN 0.1::REAL ELSE 0::REAL END))::REAL AS match_score
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        CROSS JOIN knowledge_points kp
        WHERE mc.embedding IS NOT NULL
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
$$
 LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS auto_link_materials_to_kps CASCADE;
CREATE OR REPLACE FUNCTION auto_link_materials_to_kps(
    p_min_score REAL DEFAULT 0.7
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
            (((1 - (mc.embedding <=> kp.embedding))::REAL
             + CASE WHEN NOT EXISTS (
                 SELECT 1 FROM knowledge_points child WHERE child.parent_id = kp.id
             ) THEN 0.1::REAL ELSE 0::REAL END))::REAL AS score
        FROM material_chunks mc
        JOIN learning_materials lm ON lm.id = mc.material_id
        CROSS JOIN knowledge_points kp
        WHERE mc.embedding IS NOT NULL
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
$$
 LANGUAGE plpgsql SECURITY DEFINER;
