import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { WorkspacePageShell } from "@/components/WorkspacePageShell";
import { Plan, PlanPhase, Subject, ExamInfo } from "@/types";
import { formatDate } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  CalendarRange,
  Target,
  Play,
  Pause,
  CheckCircle2,
  Clock,
} from "lucide-react";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  planning: { label: "规划中", color: "bg-gray-400" },
  active: { label: "进行中", color: "bg-emerald-500" },
  completed: { label: "已完成", color: "bg-blue-500" },
  paused: { label: "已暂停", color: "bg-amber-500" },
};

const PHASE_STATUS_MAP: Record<string, string> = {
  pending: "⏳ 待开始",
  active: "🔄 进行中",
  completed: "✅ 已完成",
};

export default function Plans() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const [editingPhase, setEditingPhase] = useState<string | null>(null);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("plans")
        .select("*, plan_phases(*)")
        .order("created_at", { ascending: false });
      return data as (Plan & { plan_phases: PlanPhase[] })[];
    },
  });

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data } = await supabase.from("subjects").select("*").order("sort_order");
      return data as Subject[];
    },
  });

  const { data: exams } = useQuery({
    queryKey: ["exams"],
    queryFn: async () => {
      const { data } = await supabase.from("exam_info").select("*");
      return data as ExamInfo[];
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <WorkspacePageShell
      title="计划"
      description="管理长期复习安排和阶段节奏。"
      actions={
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
        >
          <Plus className="w-4 h-4" />
          新建计划
        </button>
      }
      contentClassName="max-w-4xl mx-auto space-y-6"
    >

      {showForm && (
        <PlanForm
          subjects={subjects ?? []}
          exams={exams ?? []}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["plans"] });
          }}
        />
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : plans && plans.length > 0 ? (
        <div className="space-y-4">
          {plans.map((plan) => {
            const s = STATUS_MAP[plan.status];
            const isExpanded = expandedPlans.has(plan.id);
            const progress =
              plan.start_date && plan.end_date
                ? Math.min(
                    100,
                    Math.max(
                      0,
                      ((Date.now() - new Date(plan.start_date).getTime()) /
                        (new Date(plan.end_date).getTime() -
                          new Date(plan.start_date).getTime())) *
                        100
                    )
                  )
                : 0;

            return (
              <div
                key={plan.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
              >
                {/* Plan header */}
                <div
                  className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-850"
                  onClick={() => toggleExpand(plan.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button className="p-1">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <h3 className="font-semibold">{plan.name}</h3>
                      <span className={`w-2 h-2 rounded-full ${s.color}`} />
                      <span className="text-xs text-gray-400">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusToggle plan={plan} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          supabase.from("plans").delete().eq("id", plan.id).then(() =>
                            queryClient.invalidateQueries({ queryKey: ["plans"] })
                          );
                        }}
                        className="p-1 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                    <CalendarRange className="w-3.5 h-3.5" />
                    <span>{formatDate(plan.start_date)} → {formatDate(plan.end_date)}</span>
                    {plan.target_score && (
                      <>
                        <Target className="w-3.5 h-3.5 ml-2" />
                        <span>目标: {plan.target_score}分</span>
                      </>
                    )}
                    <span className="ml-auto">{Math.round(progress)}%</span>
                  </div>
                  <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Phases (expanded) */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-800 p-5 bg-gray-50/50 dark:bg-gray-800/30">
                    <PhaseList
                      phases={plan.plan_phases ?? []}
                      planId={plan.id}
                      editingPhase={editingPhase}
                      setEditingPhase={setEditingPhase}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <CalendarRange className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>还没有计划，点击「新建计划」开始吧</p>
        </div>
      )}
    </WorkspacePageShell>
  );
}

// ============================================================
// 新建计划表单
// ============================================================
function PlanForm({
  subjects,
  exams,
  onClose,
  onSaved,
}: {
  subjects: Subject[];
  exams: ExamInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: "",
    description: "",
    subject_id: "",
    exam_id: "",
    start_date: "",
    end_date: "",
    target_score: "",
  });

  const mutation = useMutation({
    mutationFn: async (f: typeof form) => {
      const { error } = await supabase.from("plans").insert({
        user_id: user?.id,
        ...f,
        subject_id: f.subject_id || null,
        exam_id: f.exam_id || null,
        target_score: f.target_score ? parseFloat(f.target_score) : null,
      });
      if (error) throw error;
    },
    onSuccess: onSaved,
  });

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">计划名称 *</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            placeholder="如: 数学一复习总计划"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">关联科目</label>
          <select
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            value={form.subject_id}
            onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
          >
            <option value="">不关联</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">关联考试</label>
          <select
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            value={form.exam_id}
            onChange={(e) => setForm({ ...form, exam_id: e.target.value })}
          >
            <option value="">不关联</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">开始日期 *</label>
          <input
            type="date"
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">结束日期 *</label>
          <input
            type="date"
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">目标分数</label>
          <input
            type="number"
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            placeholder="150"
            value={form.target_score}
            onChange={(e) => setForm({ ...form, target_score: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-400 mb-1 block">描述</label>
        <textarea
          className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          取消
        </button>
        <button
          disabled={!form.name || !form.start_date || !form.end_date}
          onClick={() => mutation.mutate(form)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          创建计划
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 阶段列表 + 管理
// ============================================================
function PhaseList({
  phases,
  planId,
  editingPhase,
  setEditingPhase,
}: {
  phases: PlanPhase[];
  planId: string;
  editingPhase: string | null;
  setEditingPhase: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [newPhase, setNewPhase] = useState({ name: "", start_date: "", end_date: "" });
  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);

  const addMutation = useMutation({
    mutationFn: async (p: typeof newPhase) => {
      const { error } = await supabase.from("plan_phases").insert({
        plan_id: planId,
        name: p.name,
        start_date: p.start_date,
        end_date: p.end_date,
        sequence: sorted.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      setNewPhase({ name: "", start_date: "", end_date: "" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await supabase.from("plan_phases").update({ status }).eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => supabase.from("plan_phases").delete().eq("id", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-gray-500">阶段拆分</h4>

      {/* Existing phases */}
      {sorted.map((phase, idx) => (
        <div
          key={phase.id}
          className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-lg border text-sm"
        >
          <span className="text-gray-300 text-xs w-5">{idx + 1}.</span>
          <span className="flex-1 font-medium">{phase.name}</span>
          <span className="text-xs text-gray-400">
            {formatDate(phase.start_date)} → {formatDate(phase.end_date)}
          </span>
          <select
            className="text-xs px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800"
            value={phase.status}
            onChange={(e) => statusMutation.mutate({ id: phase.id, status: e.target.value })}
          >
            <option value="pending">待开始</option>
            <option value="active">进行中</option>
            <option value="completed">已完成</option>
          </select>
          <button
            onClick={() => deleteMutation.mutate(phase.id)}
            className="text-gray-400 hover:text-red-500"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Add phase */}
      <div className="flex flex-wrap gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <input
          className="flex-1 min-w-[120px] px-3 py-1.5 rounded border bg-white dark:bg-gray-900 text-sm"
          placeholder="阶段名称"
          value={newPhase.name}
          onChange={(e) => setNewPhase({ ...newPhase, name: e.target.value })}
        />
        <input
          type="date"
          className="px-3 py-1.5 rounded border bg-white dark:bg-gray-900 text-sm"
          value={newPhase.start_date}
          onChange={(e) => setNewPhase({ ...newPhase, start_date: e.target.value })}
        />
        <input
          type="date"
          className="px-3 py-1.5 rounded border bg-white dark:bg-gray-900 text-sm"
          value={newPhase.end_date}
          onChange={(e) => setNewPhase({ ...newPhase, end_date: e.target.value })}
        />
        <button
          disabled={!newPhase.name}
          onClick={() => addMutation.mutate(newPhase)}
          className="px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-700 disabled:opacity-50"
        >
          添加阶段
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 状态切换按钮
// ============================================================
function StatusToggle({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (status: string) => {
      await supabase.from("plans").update({ status }).eq("id", plan.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });

  const actions: { status: string; icon: typeof Play; label: string }[] =
    plan.status === "active"
      ? [{ status: "paused", icon: Pause, label: "暂停" }]
      : plan.status === "paused" || plan.status === "planning"
      ? [{ status: "active", icon: Play, label: "开始" }]
      : [];

  if (actions.length === 0) return null;

  const action = actions[0];
  const ActionIcon = action.icon;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate(action.status);
      }}
      className="p-1 text-gray-400 hover:text-emerald-500 text-xs flex items-center gap-1"
      title={action.label}
    >
      <ActionIcon className="w-4 h-4" />
    </button>
  );
}

