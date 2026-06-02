-- ============================================================
-- 012: RLS 策略 + 去重约束
-- ============================================================

-- 去重约束
ALTER TABLE learning_materials ADD CONSTRAINT uq_lm_title_filesize UNIQUE (title, file_size);
ALTER TABLE knowledge_points ADD CONSTRAINT uq_kp_name_subject_material UNIQUE NULLS NOT DISTINCT (name, subject_id, material_id);

-- learning_materials RLS
CREATE POLICY "Anyone can view learning_materials"
  ON learning_materials FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert learning_materials"
  ON learning_materials FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update learning_materials"
  ON learning_materials FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete learning_materials"
  ON learning_materials FOR DELETE USING (auth.role() = 'authenticated');

-- knowledge_points RLS
CREATE POLICY "Anyone can view knowledge_points"
  ON knowledge_points FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert knowledge_points"
  ON knowledge_points FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update knowledge_points"
  ON knowledge_points FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete knowledge_points"
  ON knowledge_points FOR DELETE USING (auth.role() = 'authenticated');

-- material_chunks RLS
CREATE POLICY "Anyone can view material_chunks"
  ON material_chunks FOR SELECT USING (true);

-- material_knowledge_points RLS
CREATE POLICY "Anyone can view material_kp"
  ON material_knowledge_points FOR SELECT USING (true);