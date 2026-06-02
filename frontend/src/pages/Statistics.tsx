import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { BarChart3, Clock, Target, BookOpen, TrendingUp, Flame } from "lucide-react";

const COLORS = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4"];

export default function Statistics() {
  // Weekly study sessions
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
          label: ["日","一","二","三","四","五","六"][d.getDay()],
        });
      }
      return days;
    },
  });

  // Daily goals completion (last 14 days)
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
          .single();
        result.push({
          date: dateStr,
          rate: data ? Math.round((data.completion_rate ?? 0) * 100) : 0,
          label: `${d.getMonth() + 1}/${d.getDate()}`,
        });
      }
      return result;
    },
  });

  // Knowledge points by subject
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

  // Totals
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

      // Calculate streak
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
    { label: "总学习时长", value: `${Math.floor((totals?.totalMins ?? 0) / 60)}h ${(totals?.totalMins ?? 0) % 60}m`, icon: Clock, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950" },
    { label: "目标天数", value: `${totals?.totalGoals ?? 0} 天`, icon: Target, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950" },
    { label: "连续打卡", value: `${totals?.streak ?? 0} 天`, icon: Flame, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950" },
    { label: "日均学习", value: totals?.totalGoals ? `${Math.round((totals.totalMins) / (totals.totalGoals || 1))}m` : "-", icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="w-6 h-6 text-primary-500" />
        学习统计
      </h1>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statItems.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4`}>
            <Icon className={`w-5 h-5 ${color} mb-2`} />
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Weekly study time */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary-500" /> 本周学习时长 (分钟)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyData ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => [`${v} 分钟`, "学习时长"]} />
              <Bar dataKey="minutes" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Goal completion trend */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-500" /> 近14天完成率 (%)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={goalTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => [`${v}%`, "完成率"]} />
              <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Knowledge mastery */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary-500" /> 各科目知识点掌握情况
        </h3>
        {kpBySubject && kpBySubject.length > 0 ? (
          <div className="grid lg:grid-cols-2 gap-6 items-center">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={kpBySubject.map((s) => ({ name: s.name, value: s.total }))}
                  cx="50%" cy="50%" outerRadius={100}
                  dataKey="value" label={({ name, value }) => `${name} ${value}`}
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
                <div key={s.name} className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-sm flex-1">{s.name}</span>
                  <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2 flex-shrink-0">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${s.total > 0 ? Math.round((s.mastered / s.total) * 100) : 0}%`,
                        backgroundColor: s.color,
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right">
                    {s.mastered}/{s.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm py-8 text-center">暂无知识点数据</p>
        )}
      </div>
    </div>
  );
}
