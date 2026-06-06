import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { OverviewStatistics } from "@/components/OverviewStatistics";
import { WorkspacePageShell } from "@/components/WorkspacePageShell";
import {
  EmptyStatePanel,
  InsightCard,
  LinearProgress,
  MetricCard,
  PrimaryButton,
  SectionHeader,
  StatusChip,
  WorkbenchCard,
  WorkbenchInput,
} from "@/components/workbench";
import { DailyGoal, DailyGoalItem, ExamInfo, Plan } from "@/types";
import { daysUntil, formatDate, cn } from "@/lib/utils";
import {
  CalendarDays, Target, TrendingUp, CheckCircle2, BookOpen,
  Plus, Trash2, Play, Square, RefreshCw, Pencil, Smile, Frown, Meh, Brain,
} from "lucide-react";

const TODAY = new Date().toISOString().slice(0, 10);
type TodayGoal = DailyGoal & { items: DailyGoalItem[] };

export default function Dashboard() {
  const { user } = useAuth();

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
      const { data: goal } = await supabase.from("daily_goals").select("*").eq("date", TODAY).maybeSingle();
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
    {
      label: "距离考试",
      value: daysLeft !== null ? `${daysLeft} 天` : "未设置",
      hint: nextExam ? nextExam.name : "设置考试信息后显示倒计时",
      icon: <CalendarDays className="h-5 w-5" />,
      tone: "primary" as const,
    },
    {
      label: "活跃计划",
      value: `${activePlans?.length ?? 0} 个`,
      hint: activePlans?.[0]?.name ?? "当前没有进行中的长计划",
      icon: <Target className="h-5 w-5" />,
      tone: "success" as const,
    },
    {
      label: "今日进度",
      value: `${completedItems}/${totalItems}`,
      hint: totalItems > 0 ? `已完成 ${completedItems} 项任务` : "今天先列出一组学习目标",
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "secondary" as const,
    },
    {
      label: "完成率",
      value: totalItems > 0 ? `${Math.round(completionRate * 100)}%` : "-",
      hint: totalItems > 0 ? "根据今日目标实时更新" : "开始任务后自动计算",
      icon: <TrendingUp className="h-5 w-5" />,
      tone: "warning" as const,
    },
  ];

  return (
    <WorkspacePageShell
      title="总览"
      description="查看今日任务、复习节奏和近期学习趋势。"
      contentClassName="space-y-6"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, hint, icon, tone }) => (
          <MetricCard key={label} label={label} value={value} hint={hint} icon={icon} tone={tone} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <WorkbenchCard className="space-y-4">
          <SectionHeader
            title="今日目标"
            description={`按任务、番茄钟和复盘追踪今天的学习节奏 · ${TODAY}`}
            action={<StatusChip tone="info">{Math.round(completionRate * 100)}% 完成</StatusChip>}
          />
          {goalLoading ? (
            <div className="py-12 text-center text-sm text-foreground-muted">加载中...</div>
          ) : todayGoal ? (
            <DailyGoalPanel goal={todayGoal} items={items} />
          ) : null}
        </WorkbenchCard>

        <InsightCard
          title="活跃计划"
          action={<StatusChip tone={activePlans && activePlans.length > 0 ? "success" : "neutral"}>{activePlans?.length ?? 0} 个进行中</StatusChip>}
        >
          {activePlans && activePlans.length > 0 ? (
            <div className="space-y-4">
              {activePlans.map((plan) => {
                const progress = Math.min(
                  100,
                  Math.max(
                    0,
                    ((Date.now() - new Date(plan.start_date).getTime()) /
                      (new Date(plan.end_date).getTime() - new Date(plan.start_date).getTime())) *
                      100,
                  ),
                );
                return (
                  <div key={plan.id} className="rounded-lg border border-outline-variant/70 bg-surface-low p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                        <p className="text-xs text-foreground-muted">
                          {formatDate(plan.start_date)} - {formatDate(plan.end_date)}
                        </p>
                      </div>
                      <StatusChip tone="info">{Math.round(progress)}%</StatusChip>
                    </div>
                    <LinearProgress value={progress} className="mt-3" />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyStatePanel
              icon={<BookOpen className="h-5 w-5" />}
              title="暂无活跃计划"
              description="去计划页创建一条长期学习路径，这里会自动呈现进度。"
            />
          )}
        </InsightCard>
      </div>

      <OverviewStatistics />
    </WorkspacePageShell>
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
    mutationFn: async ({ title, minutes }: { title: string; minutes: number }) => {
      const { data, error } = await supabase.from("daily_goal_items").insert({
        daily_goal_id: goal.id,
        title,
        estimated_minutes: minutes,
        sort_order: items.length,
      }).select().single();
      if (error) throw error;
      return data as DailyGoalItem;
    },
    onMutate: async ({ title, minutes }) => {
      await queryClient.cancelQueries({ queryKey: ["today-goal"] });
      const previousGoal = queryClient.getQueryData<TodayGoal>(["today-goal"]);
      const now = new Date().toISOString();
      const optimisticItem: DailyGoalItem = {
        id: `temp-${Date.now()}`,
        daily_goal_id: goal.id,
        knowledge_point_id: null,
        material_id: null,
        question_id: null,
        title,
        description: null,
        estimated_minutes: minutes,
        actual_minutes: null,
        status: "pending",
        sort_order: previousGoal?.items.length ?? items.length,
        completed_at: null,
        created_at: now,
        updated_at: now,
      };

      queryClient.setQueryData<TodayGoal>(["today-goal"], (current) =>
        current ? { ...current, items: [...current.items, optimisticItem] } : current,
      );
      setNewTitle("");
      setNewMinutes(30);
      return { previousGoal, optimisticId: optimisticItem.id };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousGoal) {
        queryClient.setQueryData(["today-goal"], context.previousGoal);
      }
    },
    onSuccess: (created, _variables, context) => {
      queryClient.setQueryData<TodayGoal>(["today-goal"], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === context?.optimisticId ? created : item,
              ),
            }
          : current,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["today-goal"] });
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
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["today-goal"] });
      const previousGoal = queryClient.getQueryData<TodayGoal>(["today-goal"]);
      queryClient.setQueryData<TodayGoal>(["today-goal"], (current) =>
        current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current,
      );
      return { previousGoal };
    },
    onError: (_error, _id, context) => {
      if (context?.previousGoal) {
        queryClient.setQueryData(["today-goal"], context.previousGoal);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["today-goal"] }),
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-foreground-muted">今日心情</span>
        {[
          { value: 1, icon: Frown, color: "text-red-400" },
          { value: 3, icon: Meh, color: "text-amber-400" },
          { value: 5, icon: Smile, color: "text-emerald-400" },
        ].map(({ value, icon: Icon, color }) => (
          <button
            key={value}
            onClick={() => updateMood.mutate(value)}
            className={cn(
              "rounded-full border px-2.5 py-1.5 transition-colors",
              goal.mood === value ? "border-primary/20 bg-primary/8" : "border-outline-variant/70 hover:bg-surface-low",
            )}
          >
            <Icon className={cn("w-5 h-5", color)} />
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className={cn(
            "flex items-center gap-3 rounded-lg border p-4 transition-colors",
            item.status === "completed" ? "border-success/10 bg-success/10" :
            item.status === "in_progress" ? "border-secondary/30 bg-secondary/15" :
            "border-outline-variant/70 bg-surface-low"
          )}>
            <button onClick={() => toggleStatus.mutate({ id: item.id, status: item.status })} className="flex-shrink-0">
              {item.status === "completed" ? (
                <CheckCircle2 className="w-5 h-5 text-success" />
              ) : item.status === "in_progress" ? (
                <RefreshCw className="w-5 h-5 animate-spin text-warning" />
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-outline-variant" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <span className={cn("block text-sm text-foreground", item.status === "completed" && "line-through text-foreground-muted")}>
              {item.title}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <StatusChip tone={item.status === "completed" ? "success" : item.status === "in_progress" ? "warning" : "neutral"}>
                  {item.status === "completed" ? "已完成" : item.status === "in_progress" ? "进行中" : "待开始"}
                </StatusChip>
                {item.question_id && (
                  <a href={"/questions"} className="text-xs text-primary hover:text-primary-700 flex items-center gap-0.5" title="查看题目详情">
                    <Brain className="w-3 h-3" />
                    关联题目
                  </a>
                )}
              </div>
            </div>

            {item.status === "in_progress" && (
              <PomodoroTimer itemId={item.id} estimatedMinutes={item.estimated_minutes} />
            )}

            <span className="w-12 text-right text-xs text-foreground-muted">{item.estimated_minutes}min</span>
            <button onClick={() => deleteItem.mutate(item.id)} className="text-foreground-muted hover:text-error">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <WorkbenchInput
          className="flex-1"
          placeholder="添加任务..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            const title = newTitle.trim();
            if (e.key === "Enter" && title) addItem.mutate({ title, minutes: newMinutes });
          }}
        />
        <WorkbenchInput
          type="number"
          className="w-20 text-center"
          value={newMinutes}
          onChange={(e) => setNewMinutes(Number(e.target.value))}
          min={5} max={180} step={5}
        />
        <PrimaryButton
          disabled={!newTitle.trim()}
          onClick={() => addItem.mutate({ title: newTitle.trim(), minutes: newMinutes })}
        >
          <Plus className="w-4 h-4" />
        </PrimaryButton>
      </div>

      <div className="border-t border-outline-variant/70 pt-4">
        {editingReflection ? (
          <div className="space-y-2">
            <textarea
              className="workbench-textarea w-full"
              rows={3}
              placeholder="今日复盘..."
              value={reflectionText}
              onChange={(e) => setReflectionText(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingReflection(false)} className="px-3 py-1 text-sm text-foreground-muted">取消</button>
              <PrimaryButton onClick={() => updateReflection.mutate()} className="h-9 px-3">保存</PrimaryButton>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setReflectionText(goal.reflection ?? ""); setEditingReflection(true); }}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-outline-variant/80 bg-surface-low px-3 py-3 text-left text-sm text-foreground-muted transition hover:bg-surface-base"
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
      <span className={cn("w-10 text-right font-mono", running ? "text-warning" : "text-foreground-muted")}>
        {time}
      </span>
      <button onClick={toggle} className="p-0.5 text-foreground-muted hover:text-success">
        {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      {seconds > 0 && (
        <button onClick={finish} className="p-0.5 text-foreground-muted hover:text-success" title="完成">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
