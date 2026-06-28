// ============================================================
// 考研AI助手 · 类型定义 v3.0
// ============================================================

export interface ExamInfo {
  id: string;
  user_id: string;
  name: string;
  exam_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export type ExamInfoInsert = Omit<ExamInfo, "id" | "created_at" | "updated_at">;
export type ExamInfoUpdate = Partial<ExamInfoInsert>;

export interface Subject {
  id: string;
  user_id: string;
  name: string;
  code: string | null;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
}
export type SubjectInsert = Omit<Subject, "id" | "created_at">;
export type SubjectUpdate = Partial<SubjectInsert>;

export interface Plan {
  id: string;
  user_id: string;
  exam_id: string | null;
  subject_id: string | null;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  target_score: number | null;
  status: "planning" | "active" | "completed" | "paused";
  created_at: string;
  updated_at: string;
}
export type PlanInsert = Omit<Plan, "id" | "created_at" | "updated_at">;
export type PlanUpdate = Partial<PlanInsert>;

export interface PlanPhase {
  id: string;
  plan_id: string;
  name: string;
  description: string | null;
  sequence: number;
  start_date: string;
  end_date: string;
  status: "pending" | "active" | "completed";
  created_at: string;
}
export type PlanPhaseInsert = Omit<PlanPhase, "id" | "created_at">;
export type PlanPhaseUpdate = Partial<PlanPhaseInsert>;

// 知识点 (v3: 公有化，去 user_id，新增 material_id)
export interface KnowledgePoint {
  id: string;
  subject_id: string;
  parent_id: string | null;
  material_id: string | null;  // 关联到某本书（张宇/汤家凤），null=通用大纲
  name: string;
  description: string | null;
  difficulty: number;
  importance: number;
  sort_order: number;
  is_mastered: boolean;
  mastered_at: string | null;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}
export type KnowledgePointInsert = Omit<KnowledgePoint, "id" | "created_at" | "updated_at">;
export type KnowledgePointUpdate = Partial<KnowledgePointInsert>;

export interface DailyGoal {
  id: string;
  user_id: string;
  plan_id: string | null;
  date: string;
  title: string | null;
  notes: string | null;
  completion_rate: number;
  reflection: string | null;
  mood: number | null;
  created_at: string;
  updated_at: string;
}
export type DailyGoalInsert = Omit<DailyGoal, "id" | "created_at" | "updated_at">;
export type DailyGoalUpdate = Partial<DailyGoalInsert>;

export interface DailyGoalItem {
  id: string;
  daily_goal_id: string;
  knowledge_point_id: string | null;
  material_id: string | null;
  question_id: string | null;
  title: string;
  description: string | null;
  estimated_minutes: number;
  actual_minutes: number | null;
  status: "pending" | "in_progress" | "completed" | "skipped";
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
export type DailyGoalItemInsert = Omit<DailyGoalItem, "id" | "created_at" | "updated_at">;
export type DailyGoalItemUpdate = Partial<DailyGoalItemInsert>;

// 学习资料 (v3: 公有化，去 user_id，新增 uploaded_by + content_hash)
export interface LearningMaterial {
  id: string;
  knowledge_point_id: string | null;
  subject_id: string | null;
  webdav_config_id: string | null;
  title: string;
  type: "video" | "document" | "exercise" | "note" | "other";
  webdav_path: string;
  file_type: string | null;
  file_size: number | null;
  duration_minutes: number | null;
  source: string;
  notes: string | null;
  content: string | null;
  content_hash: string | null;
  embedding: number[] | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}
export type LearningMaterialInsert = Omit<LearningMaterial, "id" | "created_at" | "updated_at">;
export type LearningMaterialUpdate = Partial<LearningMaterialInsert>;

export interface WebdavConfig {
  id: string;
  user_id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export type WebdavConfigInsert = Omit<WebdavConfig, "id" | "created_at" | "updated_at">;
export type WebdavConfigUpdate = Partial<WebdavConfigInsert>;

export interface StudySession {
  id: string;
  user_id: string;
  goal_item_id: string | null;
  knowledge_point_id: string | null;
  material_id: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
}
export type StudySessionInsert = Omit<StudySession, "id" | "created_at">;
export type StudySessionUpdate = Partial<StudySessionInsert>;

export interface StudyPattern {
  id: string;
  user_id: string;
  daily_goal_id: string | null;
  embedding: number[] | null;
  features_json: Json | null;
  created_at: string;
}
export type StudyPatternInsert = Omit<StudyPattern, "id" | "created_at">;
export type StudyPatternUpdate = Partial<StudyPatternInsert>;

// ============================================================
// AI 配置
// ============================================================
export interface AiConfig {
  id: string;
  user_id: string;
  provider: string;
  api_key: string;
  base_url: string;
  chat_model: string;
  embed_api_key: string | null;
  embed_base_url: string | null;
  embed_model: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export type AiConfigInsert = Omit<AiConfig, "id" | "created_at" | "updated_at">;
export type AiConfigUpdate = Partial<AiConfigInsert>;

// ============================================================
// 解析任务 (v3 新增)
// ============================================================
export interface ParseTask {
  id: string;
  material_id: string;
  status: "queued" | "downloading" | "uploading" | "parsing" | "chunking" | "embedding" | "done" | "failed";
  progress_pct: number;
  message: string | null;
  result_json: {
    material_id?: string;
    text_length?: number;
    chunks_total?: number;
    chunks_embedded?: number;
    chunks_failed?: number;
  } | null;
  created_at: string;
  updated_at: string;
}

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];


// ============================================================
// 题库 (v3.2 新增)
// ============================================================
export interface QuestionBankItem {
  id: string;
  user_id: string;
  content_hash: string;
  parent_question_id: string | null;
  plan_id: string | null;
  phase_id: string | null;
  knowledge_point_ids: string[];
  material_id: string | null;
  type: "choice" | "short_answer" | "calculation" | "essay" | "true_false";
  difficulty: number;
  content: string;
  options: { label: string; text: string }[] | string;
  answer: string;
  explanation: string | null;
  source: "ai_generated" | "manual";
  source_conversation_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}
export type QuestionBankInsert = Omit<QuestionBankItem, "id" | "created_at" | "updated_at" | "content_hash">;
export type QuestionBankUpdate = Partial<QuestionBankInsert>;