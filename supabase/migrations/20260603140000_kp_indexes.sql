-- ============================================================
-- 016: knowledge_points query performance indexes
-- Speed up subject_id filter + sort_order sort for list queries
-- that exclude the heavy embedding column
-- ============================================================

-- Composite index: filter by subject then sort by sort_order
-- INCLUDE columns needed by frontend list queries (no embedding)
CREATE INDEX IF NOT EXISTS idx_kp_subject_sort
  ON knowledge_points (subject_id, sort_order)
  INCLUDE (id, parent_id, material_id, name, description, difficulty, importance, is_mastered, mastered_at, created_at, updated_at);

-- Global sort index for unfiltered list queries
CREATE INDEX IF NOT EXISTS idx_kp_sort_order
  ON knowledge_points (sort_order)
  INCLUDE (id, subject_id, parent_id, material_id, name, description, difficulty, importance, is_mastered, mastered_at, created_at, updated_at);