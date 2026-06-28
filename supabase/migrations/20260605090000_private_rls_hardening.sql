-- ============================================================
-- Private RLS hardening
-- ============================================================
-- 所有用户资料/知识点/分块默认私有，撤销 012 中的宽松策略。

ALTER TABLE learning_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_knowledge_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE parse_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view learning_materials" ON learning_materials;
DROP POLICY IF EXISTS "Authenticated can insert learning_materials" ON learning_materials;
DROP POLICY IF EXISTS "Authenticated can update learning_materials" ON learning_materials;
DROP POLICY IF EXISTS "Authenticated can delete learning_materials" ON learning_materials;
DROP POLICY IF EXISTS "Users manage own learning_materials" ON learning_materials;

CREATE POLICY "Users manage own learning_materials"
  ON learning_materials FOR ALL
  USING (auth.uid() = uploaded_by)
  WITH CHECK (auth.uid() = uploaded_by);

DROP POLICY IF EXISTS "Anyone can view knowledge_points" ON knowledge_points;
DROP POLICY IF EXISTS "Authenticated can insert knowledge_points" ON knowledge_points;
DROP POLICY IF EXISTS "Authenticated can update knowledge_points" ON knowledge_points;
DROP POLICY IF EXISTS "Authenticated can delete knowledge_points" ON knowledge_points;
DROP POLICY IF EXISTS "Users manage own knowledge_points" ON knowledge_points;

CREATE POLICY "Users manage own knowledge_points"
  ON knowledge_points FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM subjects s
      WHERE s.id = knowledge_points.subject_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM subjects s
      WHERE s.id = knowledge_points.subject_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Anyone can view material_chunks" ON material_chunks;
DROP POLICY IF EXISTS "Users access own chunks" ON material_chunks;

CREATE POLICY "Users access own chunks"
  ON material_chunks FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM learning_materials lm
      WHERE lm.id = material_chunks.material_id
        AND auth.uid() = lm.uploaded_by
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning_materials lm
      WHERE lm.id = material_chunks.material_id
        AND auth.uid() = lm.uploaded_by
    )
  );

DROP POLICY IF EXISTS "Anyone can view material_kp" ON material_knowledge_points;
DROP POLICY IF EXISTS "Users access own material_kp" ON material_knowledge_points;

CREATE POLICY "Users access own material_kp"
  ON material_knowledge_points FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM learning_materials lm
      WHERE lm.id = material_knowledge_points.material_id
        AND auth.uid() = lm.uploaded_by
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning_materials lm
      WHERE lm.id = material_knowledge_points.material_id
        AND auth.uid() = lm.uploaded_by
    )
  );

DROP POLICY IF EXISTS "Authenticated users can view parse tasks" ON parse_tasks;
DROP POLICY IF EXISTS "Users view own parse tasks" ON parse_tasks;

CREATE POLICY "Users view own parse tasks"
  ON parse_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM learning_materials lm
      WHERE lm.id = parse_tasks.material_id
        AND auth.uid() = lm.uploaded_by
    )
  );
