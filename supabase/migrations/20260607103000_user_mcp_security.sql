-- ============================================================
-- 用户态 MCP 检索安全收口（兼容旧/新函数签名）
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'search_chunks_by_vector'
      AND oid::regprocedure::text = 'search_chunks_by_vector(vector,uuid[],integer,real)'
  ) THEN
    EXECUTE 'ALTER FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'search_chunks_by_vector'
      AND oid::regprocedure::text = 'search_chunks_by_vector(vector,uuid[],integer,real,uuid)'
  ) THEN
    EXECUTE 'ALTER FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL, UUID) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL, UUID) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL, UUID) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION search_chunks_by_vector(VECTOR, UUID[], INT, REAL, UUID) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'search_chunks_hybrid'
      AND oid::regprocedure::text = 'search_chunks_hybrid(vector,text[],uuid[],integer,real)'
  ) THEN
    EXECUTE 'ALTER FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'search_chunks_hybrid'
      AND oid::regprocedure::text = 'search_chunks_hybrid(vector,text[],uuid[],integer,real,uuid)'
  ) THEN
    EXECUTE 'ALTER FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION search_chunks_hybrid(VECTOR, TEXT[], UUID[], INT, REAL, UUID) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'search_kps_by_vector'
      AND oid::regprocedure::text = 'search_kps_by_vector(vector,uuid[],integer,real)'
  ) THEN
    EXECUTE 'ALTER FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'search_kps_by_vector'
      AND oid::regprocedure::text = 'search_kps_by_vector(vector,uuid[],integer,real,uuid)'
  ) THEN
    EXECUTE 'ALTER FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL, UUID) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL, UUID) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL, UUID) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION search_kps_by_vector(VECTOR, UUID[], INT, REAL, UUID) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'find_similar_questions'
      AND oid::regprocedure::text = 'find_similar_questions(uuid,integer,real)'
  ) THEN
    EXECUTE 'ALTER FUNCTION find_similar_questions(UUID, INT, REAL) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL) TO authenticated, service_role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'find_similar_questions'
      AND oid::regprocedure::text = 'find_similar_questions(uuid,integer,real,uuid)'
  ) THEN
    EXECUTE 'ALTER FUNCTION find_similar_questions(UUID, INT, REAL, UUID) SECURITY INVOKER';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL, UUID) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL, UUID) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION find_similar_questions(UUID, INT, REAL, UUID) TO authenticated, service_role';
  END IF;
END $$;
