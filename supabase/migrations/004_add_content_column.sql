-- ============================================================
-- 004: 学习资料新增 content 字段 (存储 PDF/文档解析后的纯文本)
-- ============================================================

-- 1. 新增 content 列
ALTER TABLE learning_materials
  ADD COLUMN IF NOT EXISTS content TEXT;

-- 2. 注释
COMMENT ON COLUMN learning_materials.content
  IS '从 PDF / 文档中提取的纯文本正文, 用于生成高质量 embedding';

-- 3. 为已有数据的 content 补一个默认 (后续重新 parse)
-- UPDATE learning_materials SET content = notes WHERE content IS NULL AND notes IS NOT NULL;
