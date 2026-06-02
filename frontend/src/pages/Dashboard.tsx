import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { DailyGoal, DailyGoalItem, ExamInfo, Plan, Subject } from "@/types";
import { daysUntil, formatDate, cn } from "@/lib/utils";
import {
  CalendarDays, Target, TrendingUp, CheckCircle2, Clock, BookOpen,
  Plus, Trash2, Play, Square, RefreshCw, Pencil, Smile, Frown, Meh,
} from "lucide-react";

const TODAY = new Date().toISOString().slice(0, 10);

export default function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: exams } = useQuery({
    queryKey: ["exams"],
    queryFn: async () => {
      const { data } = await supabase.from("exam_info").select("*").order("exam_date");
      return data as ExamInfo[];
    },
  });

  const { data: activePlans } = useQuery({
    queryKey: ["active-plans"],
    queryFn: async () => {
      const { data } = await supabase.from("plans").select("*").eq("status", "active").order("end_date");
      return data as Plan[];
    },
  });

  // Today's goal (auto-create if missing)
  const { data: todayGoal, isLoading: goalLoading } = useQuery({
    queryKey: ["today-goal"],
    queryFn: async () => {
      const { data: goal } = await supabase.from("daily_goals").select("*").eq("date", TODAY).single();
      if (goal) {
        const { data: items } = await supabase
          .from("daily_goal_items").select("*").eq("daily_goal_id", goal.id).order("sort_order");
        return { ...goal, items: items ?? [] } as DailyGoal & { items: DailyGoalItem[] };
      }
      // Auto-create
      const { data: created } = await supabase
        .from("daily_goals").insert({ user_id: user?.id, date: TODAY }).select().single();
      return { ...created, items: [] } as DailyGoal & { items: DailyGoalItem[] };
    },
  });

  const nextExam = exams?.[0];
  const daysLeft = nextExam ? daysUntil(nextExam.exam_date) : null;
  const items = todayGoal?.items ?? [];
  const completedItems = items.filter((i) => i.status === "completed").length;
  const totalItems = items.length;
  const completionRate = totalItems > 0 ? completedItems / totalItems : 0;

  const statCards = [
    { label: "距离考试", value: daysLeft !== null ? `${daysLeft} 天` : "未设置", icon: CalendarDays, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950" },
    { label: "活跃计划", value: `${activePlans?.length ?? 0} 个`, icon: Target, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950" },
    { label: "今日进度", value: `${completedItems}/${totalItems}`, icon: CheckCircle2, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950" },
    { label: "完成率", value: totalItems > 0 ? `${Math.round(completionRate * 100)}%` : "-", icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">仪表盘</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4`}>
            <Icon className={`w-5 h-5 ${color} mb-2`} />
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Daily Goals */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-500" />
            今日目标 ({TODAY})
          </h2>
          {goalLoading ? (
            <p className="text-gray-400 text-sm">加载中...</p>
          ) : todayGoal ? (
            <DailyGoalPanel goal={todayGoal} items={items} />
          ) : null}
        </div>

        {/* Active Plans */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary-500" />
            活跃计划
          </h2>
          {activePlans && activePlans.length > 0 ? (
            <ul className="space-y-3">
              {activePlans.map((plan) => {
                const progress = Math.min(100, Math.max(0,
                  ((Date.now() - new Date(plan.start_date).getTime()) /
                    (new Date(plan.end_date).getTime() - new Date(plan.start_date).getTime())) * 100
                ));
                return (
                  <li key={plan.id} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{plan.name}</span>
                      <span className="text-xs text-gray-400">
                        {formatDate(plan.start_date)} → {formatDate(plan.end_date)}
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                      <div className="bg-primary-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm py-8 text-center">暂无活跃计划</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 每日目标面板
// ============================================================
function DailyGoalPanel({ goal, items }: { goal: DailyGoal; items: DailyGoalItem[] }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState(30);
  const [editingReflection, setEditingReflection] = useState(false);
  const [reflectionText, setReflectionText] = useState(goal.reflection ?? "");

  const addItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("daily_goal_items").insert({
        daily_goal_id: goal.id,
        title: newTitle,
        estimated_minutes: newMinutes,
        sort_order: items.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-goal"] });
      setNewTitle("");
      setNewMinutes(30);
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === "completed" ? "pending" : status === "pending" ? "in_progress" : "completed";
      await supabase.from("daily_goal_items").update({
        status: newStatus,
        completed_at: newStatus === "completed" ? new Date().toISOString() : null,
      }).eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today-goal"] }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => supabase.from("daily_goal_items").delete().eq("id", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today-goal"] }),
  });

  const updateReflection = useMutation({
    mutationFn: async () => {
      await supabase.from("daily_goals").update({ reflection: reflectionText }).eq("id", goal.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-goal"] });
      setEditingReflection(false);
    },
  });

  const updateMood = useMutation({
    mutationFn: async (mood: number) => {
      await supabase.from("daily_goals").update({ mood }).eq("id", goal.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today-goal"] }),
  });

  // Update completion rate
  const recalcRate = useCallback(() => {
    const done = items.filter((i) => i.status === "completed").length;
    const rate = items.length > 0 ? done / items.length : 0;
    supabase.from("daily_goals").update({ completion_rate: rate }).eq("id", goal.id);
  }, [items, goal.id]);

  useEffect(() => { recalcRate(); }, [items.length]);

  return (
    <div className="space-y-4">
      {/* Mood selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">今日心情:</span>
        {[
          { value: 1, icon: Frown, color: "text-red-400" },
          { value: 3, icon: Meh, color: "text-amber-400" },
          { value: 5, icon: Smile, color: "text-emerald-400" },
        ].map(({ value, icon: Icon, color }) => (
          <button
            key={value}
            onClick={() => updateMood.mutate(value)}
            className={cn("p-1 rounded transition-colors", goal.mood === value ? "bg-gray-100 dark:bg-gray-700" : "hover:bg-gray-50")}
          >
            <Icon className={cn("w-5 h-5", color)} />
          </button>
        ))}
      </div>

      {/* Items */}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className={cn(
            "flex items-center gap-3 p-3 rounded-lg transition-colors",
            item.status === "completed" ? "bg-emerald-50/50 dark:bg-emerald-950/30" :
            item.status === "in_progress" ? "bg-amber-50/50 dark:bg-amber-950/30" :
            "bg-gray-50 dark:bg-gray-800"
          )}>
            <button onClick={() => toggleStatus.mutate({ id: item.id, status: item.status })} className="flex-shrink-0">
              {item.status === "completed" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              ) : item.status === "in_progress" ? (
                <RefreshCw className="w-5 h-5 text-amber-500 animate-spin" />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
              )}
            </button>
            <span className={cn("flex-1 text-sm", item.status === "completed" && "line-through text-gray-400")}>
              {item.title}
            </span>

            {/* Pomodoro timer for in-progress */}
            {item.status === "in_progress" && (
              <PomodoroTimer itemId={item.id} estimatedMinutes={item.estimated_minutes} />
            )}

            <span className="text-xs text-gray-400 w-12 text-right">{item.estimated_minutes}min</span>
            <button onClick={() => deleteItem.mutate(item.id)} className="text-gray-400 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {/* Add item */}
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
          placeholder="添加任务..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addItem.mutate(); }}
        />
        <input
          type="number"
          className="w-16 px-2 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm text-center"
          value={newMinutes}
          onChange={(e) => setNewMinutes(Number(e.target.value))}
          min={5} max={180} step={5}
        />
        <button
          disabled={!newTitle.trim()}
          onClick={() => addItem.mutate()}
          className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Reflection */}
      <div className="border-t pt-3 mt-2">
        {editingReflection ? (
          <div className="space-y-2">
            <textarea
              className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
              rows={3}
              placeholder="今日复盘..."
              value={reflectionText}
              onChange={(e) => setReflectionText(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingReflection(false)} className="px-3 py-1 text-sm text-gray-500">取消</button>
              <button onClick={() => updateReflection.mutate()} className="px-3 py-1 bg-primary-600 text-white rounded text-sm">保存</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setReflectionText(goal.reflection ?? ""); setEditingReflection(true); }}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 w-full text-left"
          >
            <Pencil className="w-3.5 h-3.5" />
            {goal.reflection || "写今日复盘..."}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 番茄钟组件
// ============================================================
function PomodoroTimer({ itemId, estimatedMinutes }: { itemId: string; estimatedMinutes: number }) {
  const { user } = useAuth();
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);

  const toggle = () => setRunning(!running);

  const finish = () => {
    setRunning(false);
    const mins = Math.round(seconds / 60);
    supabase.from("daily_goal_items").update({
      actual_minutes: mins,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", itemId).then(() => {
      // Record study session
      supabase.from("study_sessions").insert({
        user_id: user?.id,
        goal_item_id: itemId,
        start_time: new Date(Date.now() - seconds * 1000).toISOString(),
        end_time: new Date().toISOString(),
        duration_minutes: mins,
      }).then(() => queryClient.invalidateQueries({ queryKey: ["today-goal"] }));
    });
  };

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const time = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={cn("font-mono w-10 text-right", running ? "text-amber-600" : "text-gray-400")}>
        {time}
      </span>
      <button onClick={toggle} className="p-0.5 text-gray-400 hover:text-emerald-500">
        {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      {seconds > 0 && (
        <button onClick={finish} className="p-0.5 text-gray-400 hover:text-emerald-500" title="完成">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
