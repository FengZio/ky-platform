-- ============================================================
-- 019: 通用任务队列表 (统一 PDF 导出 + 资料解析)
-- ============================================================

CREATE TABLE task_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    task_type       TEXT NOT NULL CHECK (task_type IN ('pdf_export', 'doc_parse')),
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'processing', 'done', 'failed')),
    progress_pct    INT DEFAULT 0,
    message         TEXT,
    payload_json    JSONB DEFAULT '{}'::JSONB,      -- 输入参数 (question_ids / material_id)
    result_json     JSONB DEFAULT '{}'::JSONB,      -- 输出结果 (download_url / file_size / chunks)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_tq_user_status ON task_queue(user_id, status);
CREATE INDEX idx_tq_type ON task_queue(task_type);
CREATE INDEX idx_tq_created ON task_queue(created_at DESC);

-- Auto updated_at
CREATE TRIGGER set_updated_at_task_queue
  BEFORE UPDATE ON task_queue FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tasks"
  ON task_queue FOR ALL USING (auth.uid() = user_id);

GRANT ALL ON task_queue TO anon, authenticated;
