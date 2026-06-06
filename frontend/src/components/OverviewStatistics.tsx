import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { InsightCard, MetricCard, SectionHeader, SecondaryButton, WorkbenchCard } from "@/components/workbench";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { Clock, Target, BookOpen, TrendingUp, Flame, ArrowRight } from "lucide-react";

const COLORS = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4"];

export function OverviewStatistics() {
  const { data: weeklyData } = useQuery({
    queryKey: ["weekly-study"],
    queryFn: async () => {
      const days: { date: string; minutes: number; label: string }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const { data } = await supabase
          .from("study_sessions")
          .select("duration_minutes")
          .gte("start_time", dateStr)
          .lt("start_time", new Date(d.getTime() + 86400000).toISOString().slice(0, 10));
        const mins = data?.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0) ?? 0;
        days.push({
          date: dateStr,
          minutes: Math.round(mins),
          label: ["日", "一", "二", "三", "四", "五", "六"][d.getDay()],
        });
      }
      return days;
    },
  });

  const { data: goalTrend } = useQuery({
    queryKey: ["goal-trend"],
    queryFn: async () => {
      const result: { date: string; rate: number; label: string }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const { data } = await supabase
          .from("daily_goals")
          .select("completion_rate")
          .eq("date", dateStr)
          .maybeSingle();
        result.push({
          date: dateStr,
          rate: data ? Math.round((data.completion_rate ?? 0) * 100) : 0,
          label: `${d.getMonth() + 1}/${d.getDate()}`,
        });
      }
      return result;
    },
  });

  const { data: kpBySubject } = useQuery({
    queryKey: ["kp-by-subject"],
    queryFn: async () => {
      const { data: subjects } = await supabase.from("subjects").select("*");
      const { data: kps } = await supabase.from("knowledge_points").select("subject_id, is_mastered");
      if (!subjects) return [];
      return subjects.map((s, i) => {
        const total = kps?.filter((k) => k.subject_id === s.id).length ?? 0;
        const mastered = kps?.filter((k) => k.subject_id === s.id && k.is_mastered).length ?? 0;
        return { name: s.name, total, mastered, color: s.color || COLORS[i % COLORS.length] };
      });
    },
  });

  const { data: totals } = useQuery({
    queryKey: ["stats-totals"],
    queryFn: async () => {
      const [sessionsRes, goalsRes, streakRes] = await Promise.all([
        supabase.from("study_sessions").select("duration_minutes"),
        supabase.from("daily_goals").select("completion_rate, mood"),
        supabase.from("daily_goals").select("date").order("date", { ascending: false }).limit(30),
      ]);
      const totalMins = sessionsRes.data?.reduce((s, r) => s + (r.duration_minutes ?? 0), 0) ?? 0;
      const totalGoals = goalsRes.data?.length ?? 0;

      let streak = 0;
      const dates = new Set((streakRes.data ?? []).map((g) => g.date));
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
        if (dates.has(d)) streak++;
        else break;
      }

      return { totalMins: Math.round(totalMins), totalGoals, streak };
    },
  });

  const statItems = [
    { label: "总学习时长", value: `${Math.floor((totals?.totalMins ?? 0) / 60)}h ${(totals?.totalMins ?? 0) % 60}m`, icon: <Clock className="h-5 w-5" />, tone: "primary" as const, hint: "累计进入深度学习时段" },
    { label: "目标天数", value: `${totals?.totalGoals ?? 0} 天`, icon: <Target className="h-5 w-5" />, tone: "success" as const, hint: "已留下可追踪目标记录" },
    { label: "连续打卡", value: `${totals?.streak ?? 0} 天`, icon: <Flame className="h-5 w-5" />, tone: "warning" as const, hint: "保持节奏比爆发更重要" },
    { label: "日均学习", value: totals?.totalGoals ? `${Math.round((totals.totalMins) / (totals.totalGoals || 1))}m` : "-", icon: <TrendingUp className="h-5 w-5" />, tone: "secondary" as const, hint: "按已记录目标日计算" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statItems.map(({ label, value, icon, tone, hint }) => (
          <MetricCard key={label} label={label} value={value} icon={icon} tone={tone} hint={hint} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <WorkbenchCard className="space-y-4">
          <SectionHeader title="学习时长" description="近 7 天每日投入时长（分钟）" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyData ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9e3f4" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#434654" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#434654" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [`${v} 分钟`, "学习时长"]} />
              <Bar dataKey="minutes" fill="#003fb1" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </WorkbenchCard>

        <WorkbenchCard className="space-y-4">
          <SectionHeader title="目标完成率" description="近 14 天任务完成曲线（%）" />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={goalTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9e3f4" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#434654" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "#434654" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [`${v}%`, "完成率"]} />
              <Line type="monotone" dataKey="rate" stroke="#0e9f6e" strokeWidth={2.5} dot={{ r: 3, fill: "#0e9f6e" }} />
            </LineChart>
          </ResponsiveContainer>
        </WorkbenchCard>
      </div>

      <InsightCard
        title="学科掌握度"
        action={
          <SecondaryButton disabled className="h-9 px-3 text-xs">
            生成分析
            <ArrowRight className="h-3.5 w-3.5" />
          </SecondaryButton>
        }
      >
        {kpBySubject && kpBySubject.length > 0 ? (
          <div className="grid items-center gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={kpBySubject.map((s) => ({ name: s.name, value: s.total }))}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={96}
                  dataKey="value"
                  label={({ name, value }) => `${name} ${value}`}
                >
                  {kpBySubject.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {kpBySubject.map((s) => (
                <div key={s.name} className="rounded-lg border border-outline-variant/70 bg-surface-low p-4">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 text-sm font-medium text-foreground">{s.name}</span>
                    <span className="text-xs text-foreground-muted">{s.mastered}/{s.total}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-high">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${s.total > 0 ? Math.round((s.mastered / s.total) * 100) : 0}%`,
                        backgroundColor: s.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-foreground-muted">暂无知识点数据</p>
        )}
      </InsightCard>
    </div>
  );
}
