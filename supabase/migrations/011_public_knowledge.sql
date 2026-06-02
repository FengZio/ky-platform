-- ============================================================
-- 011: 知识库公有化 — 字段变更
-- ============================================================

-- 1. 先删依赖 user_id 的 RLS 策略 (012 会重建)
DROP POLICY IF EXISTS "Users manage own learning_materials" ON learning_materials;
DROP POLICY IF EXISTS "Users access own chunks" ON material_chunks;
DROP POLICY IF EXISTS "Users access own material_kp" ON material_knowledge_points;
DROP POLICY IF EXISTS "Users manage own knowledge_points" ON knowledge_points;

-- 2. learning_materials: 新增列
ALTER TABLE learning_materials
  ADD COLUMN IF NOT EXISTS uploaded_by UUID,
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- 3. knowledge_points: 新增 material_id
ALTER TABLE knowledge_points
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES learning_materials(id) ON DELETE SET NULL;

-- 4. 删 user_id
ALTER TABLE learning_materials DROP COLUMN IF EXISTS user_id;
ALTER TABLE knowledge_points DROP COLUMN IF EXISTS user_id;