-- ============================================================
-- 资料关联改为学科：从旧知识点关联回填 learning_materials.subject_id
-- ============================================================

-- 1. 旧的一对一字段：learning_materials.knowledge_point_id -> knowledge_points.subject_id
UPDATE learning_materials lm
SET subject_id = kp.subject_id
FROM knowledge_points kp
WHERE lm.subject_id IS NULL
  AND lm.knowledge_point_id = kp.id;

-- 2. 旧的多对多表：material_knowledge_points.kp_id -> knowledge_points.subject_id
-- 同一资料若关联多个知识点，取关联次数最多、最近出现的学科。
WITH subject_votes AS (
  SELECT
    mkp.material_id,
    kp.subject_id,
    COUNT(*) AS vote_count,
    MAX(mkp.created_at) AS latest_linked_at
  FROM material_knowledge_points mkp
  JOIN knowledge_points kp ON kp.id = mkp.kp_id
  GROUP BY mkp.material_id, kp.subject_id
),
best_subject AS (
  SELECT DISTINCT ON (material_id)
    material_id,
    subject_id
  FROM subject_votes
  ORDER BY material_id, vote_count DESC, latest_linked_at DESC
)
UPDATE learning_materials lm
SET subject_id = bs.subject_id
FROM best_subject bs
WHERE lm.subject_id IS NULL
  AND lm.id = bs.material_id;

COMMENT ON COLUMN learning_materials.subject_id IS '学习资料所属学科；学习资料页面直接维护该字段，不再通过知识点关联选择资料学科';
