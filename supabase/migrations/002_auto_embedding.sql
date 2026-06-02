-- ============================================================
-- 自动 Embedding 触发器 (依赖 pg_net 扩展)
-- ============================================================
-- 注意: pg_net 需要 Supabase 项目启用该扩展
-- 如果未启用, 改为应用层调用 Edge Function

-- 启用 pg_net (如果可用)
-- CREATE EXTENSION IF NOT EXISTS 'pg_net';

-- ============================================================
-- 知识点: INSERT/UPDATE 时自动生成 embedding
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_kp_embedding()
RETURNS TRIGGER AS 
DECLARE
    embedding_text TEXT;
BEGIN
    -- 仅当 name 或 description 变化时重新生成
    IF (TG_OP = 'INSERT') OR
       (TG_OP = 'UPDATE' AND (
          NEW.name IS DISTINCT FROM OLD.name OR
          NEW.description IS DISTINCT FROM OLD.description
       )) THEN

        embedding_text := '知识点: ' || COALESCE(NEW.name, '') || E'\n描述: ' || COALESCE(NEW.description, '');

        -- 异步调用 Edge Function
        PERFORM net.http_post(
            url := current_setting('app.edge_function_url') || '/generate-embedding',
            body := jsonb_build_object(
                'table', 'knowledge_points',
                'record', jsonb_build_object(
                    'id', NEW.id,
                    'name', NEW.name,
                    'description', NEW.description
                )
            )::text,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || current_setting('app.edge_function_key')
            )
        );
    END IF;

    RETURN NEW;
END;
 LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 学习资料: INSERT/UPDATE 时自动生成 embedding (含 content 正文)
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_lm_embedding()
RETURNS TRIGGER AS 
DECLARE
    embedding_text TEXT;
BEGIN
    IF (TG_OP = 'INSERT') OR
       (TG_OP = 'UPDATE' AND (
          NEW.title IS DISTINCT FROM OLD.title OR
          NEW.type IS DISTINCT FROM OLD.type OR
          NEW.notes IS DISTINCT FROM OLD.notes OR
          NEW.content IS DISTINCT FROM OLD.content
       )) THEN

        embedding_text := '资料: ' || COALESCE(NEW.title, '') ||
                         E'\n类型: ' || COALESCE(NEW.type, '') ||
                         E'\n备注: ' || COALESCE(NEW.notes, '') ||
                         E'\n正文: ' || COALESCE(NEW.content, '');

        PERFORM net.http_post(
            url := current_setting('app.edge_function_url') || '/generate-embedding',
            body := jsonb_build_object(
                'table', 'learning_materials',
                'record', jsonb_build_object(
                    'id', NEW.id,
                    'title', NEW.title,
                    'type', NEW.type,
                    'notes', NEW.notes,
                    'content', NEW.content
                )
            )::text,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || current_setting('app.edge_function_key')
            )
        );
    END IF;

    RETURN NEW;
END;
 LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 挂载触发器 (可选, 按需执行)
-- ============================================================

-- 知识点自动 embedding:
-- CREATE TRIGGER auto_embed_kp
--   AFTER INSERT OR UPDATE ON knowledge_points
--   FOR EACH ROW EXECUTE FUNCTION trigger_kp_embedding();

-- 学习资料自动 embedding:
-- CREATE TRIGGER auto_embed_lm
--   AFTER INSERT OR UPDATE ON learning_materials
--   FOR EACH ROW EXECUTE FUNCTION trigger_lm_embedding();


-- ============================================================
-- 手动批量生成 embedding (用于已有数据补全)
-- ============================================================
CREATE OR REPLACE FUNCTION batch_generate_embeddings(
    p_user_id UUID,
    p_table TEXT  -- 'knowledge_points' | 'learning_materials'
)
RETURNS TABLE(processed INT) AS 
DECLARE
    rec RECORD;
    cnt INT := 0;
BEGIN
    IF p_table = 'knowledge_points' THEN
        FOR rec IN
            SELECT id, name, description
            FROM knowledge_points
            WHERE user_id = p_user_id AND embedding IS NULL
        LOOP
            cnt := cnt + 1;
        END LOOP;
    ELSIF p_table = 'learning_materials' THEN
        FOR rec IN
            SELECT id, title, type, notes, content
            FROM learning_materials
            WHERE user_id = p_user_id AND embedding IS NULL
        LOOP
            cnt := cnt + 1;
        END LOOP;
    END IF;

    processed := cnt;
    RETURN NEXT;
END;
 LANGUAGE plpgsql SECURITY DEFINER;
