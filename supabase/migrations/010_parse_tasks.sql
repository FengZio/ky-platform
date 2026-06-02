-- ============================================================
-- 010: 解析任务表 (任务状态持久化)
-- ============================================================
-- BackgroundTasks 每步写入 DB，FastAPI 重启不丢状态

CREATE TABLE parse_tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id  UUID,
    status       TEXT DEFAULT 'queued'
                 CHECK (status IN ('queued','downloading','uploading','parsing','chunking','embedding','done','failed')),
    progress_pct INT DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
    message      TEXT,
    result_json  JSONB,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE parse_tasks IS '文档解析任务表，BackgroundTasks 每一步写入状态，进程重启不丢失';

CREATE INDEX idx_parse_tasks_status ON parse_tasks(status);
CREATE INDEX idx_parse_tasks_created ON parse_tasks(created_at DESC);

ALTER TABLE parse_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view parse tasks"
  ON parse_tasks FOR SELECT
  USING (auth.role() = 'authenticated');

GRANT ALL ON parse_tasks TO anon, authenticated;