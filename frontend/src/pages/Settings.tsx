import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { ExamInfo, Subject, WebdavConfig } from "@/types";
import { formatDate, cn, toBase64 } from "@/lib/utils";
import {
  Plus, Trash2, GraduationCap, BookOpen, HardDrive, Cpu,
} from "lucide-react";

const SUBJECT_COLORS = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4"];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<"exam" | "subject" | "webdav" | "ai">("exam");
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit flex-wrap">
        {[
          { key: "exam", icon: GraduationCap, label: "考试信息" },
          { key: "subject", icon: BookOpen, label: "科目管理" },
          { key: "webdav", icon: HardDrive, label: "WebDAV" },
          { key: "ai", icon: Cpu, label: "AI供应商" },
        ].map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === key ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>
      {activeTab === "exam" ? <ExamManager /> : activeTab === "subject" ? <SubjectManager /> : activeTab === "webdav" ? <WebdavManager /> : <AiConfigPanel />}
    </div>
  );
}

// ============================================================
function ExamManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", exam_date: "", notes: "" });
  const { data: exams, isLoading } = useQuery({ queryKey: ["exams"], queryFn: async () => { const { data } = await supabase.from("exam_info").select("*").order("exam_date"); return data as ExamInfo[]; } });
  const addMutation = useMutation({ mutationFn: async (e: typeof form) => { const { data, error } = await supabase.from("exam_info").insert({ user_id: user?.id, ...e }).select().single(); if (error) throw error; return data; }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["exams"] }); setForm({ name: "", exam_date: "", notes: "" }); } });
  const deleteMutation = useMutation({ mutationFn: async (id: string) => supabase.from("exam_info").delete().eq("id", id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exams"] }) });
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5">
      <h2 className="font-semibold text-lg mb-4">考试信息</h2>
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <input className="flex-1 min-w-[150px] px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" placeholder="考试名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="date" className="px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
        <button disabled={!form.name || !form.exam_date} onClick={() => addMutation.mutate(form)} className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"><Plus className="w-4 h-4" />添加</button>
      </div>
      {isLoading ? <p className="text-gray-400 text-sm">加载中...</p> : exams && exams.length > 0 ? (
        <ul className="space-y-2">
          {exams.map((exam) => { const daysLeft = Math.ceil((new Date(exam.exam_date).getTime() - Date.now()) / 86400000); return (
            <li key={exam.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div><span className="font-medium">{exam.name}</span><span className="ml-3 text-sm text-gray-400">{formatDate(exam.exam_date)}</span></div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${daysLeft < 30 ? "text-red-500" : daysLeft < 90 ? "text-amber-500" : "text-emerald-500"}`}>倒计时 {daysLeft} 天</span>
                <button onClick={() => deleteMutation.mutate(exam.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            </li>
          )})}
        </ul>
      ) : <p className="text-gray-400 text-sm py-4 text-center">暂无考试</p>}
    </div>
  );
}

// ============================================================
function SubjectManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", code: "", color: SUBJECT_COLORS[0] });
  const { data: subjects, isLoading } = useQuery({ queryKey: ["subjects"], queryFn: async () => { const { data } = await supabase.from("subjects").select("*").order("sort_order"); return data as Subject[]; } });
  const addMutation = useMutation({ mutationFn: async (s: typeof form) => { await supabase.from("subjects").insert({ user_id: user?.id, ...s, sort_order: (subjects?.length ?? 0) + 1 }); }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["subjects"] }); setForm({ name: "", code: "", color: SUBJECT_COLORS[0] }); } });
  const deleteMutation = useMutation({ mutationFn: async (id: string) => supabase.from("subjects").delete().eq("id", id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subjects"] }) });
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5">
      <h2 className="font-semibold text-lg mb-4">科目管理</h2>
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg items-end">
        <div className="flex-1 min-w-[120px]"><label className="text-xs text-gray-400 mb-1 block">科目名称</label><input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" placeholder="如: 数学一" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="w-24"><label className="text-xs text-gray-400 mb-1 block">代码</label><input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" placeholder="math1" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">颜色</label><div className="flex gap-1">{SUBJECT_COLORS.map((c) => <button key={c} className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c ? "border-gray-800 scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} onClick={() => setForm({ ...form, color: c })} />)}</div></div>
        <button disabled={!form.name} onClick={() => addMutation.mutate(form)} className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"><Plus className="w-4 h-4" />添加</button>
      </div>
      {isLoading ? <p className="text-gray-400 text-sm">加载中...</p> : subjects && subjects.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{subjects.map((s) => (<div key={s.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: s.color + "40" }}><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} /><span className="text-sm font-medium">{s.name}</span></div><button onClick={() => deleteMutation.mutate(s.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></div>))}</div>
      ) : <p className="text-gray-400 text-sm py-4 text-center">暂无科目</p>}
    </div>
  );
}

// ============================================================
function WebdavManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "夸克网盘", url: "", username: "", password: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const { data: configs } = useQuery({ queryKey: ["webdav-configs"], queryFn: async () => { const { data } = await supabase.from("webdav_configs").select("*"); return data as WebdavConfig[]; } });
  const addMutation = useMutation({ mutationFn: async (f: typeof form) => { await supabase.from("webdav_configs").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000"); await supabase.from("webdav_configs").insert({ user_id: user?.id, ...f, is_active: true }); }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["webdav-configs"] }); setForm({ name: "夸克网盘", url: "", username: "", password: "" }); setTestResult(null); } });
  const deleteMutation = useMutation({ mutationFn: async (id: string) => supabase.from("webdav_configs").delete().eq("id", id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webdav-configs"] }) });
  const testConnection = async () => {
    if (!form.url || !form.username || !form.password) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setTestResult("\u274c \u672a\u767b\u5f55"); setTesting(false); return; }
      const res = await fetch(
        import.meta.env.VITE_SUPABASE_URL + "/functions/v1/webdav-proxy?path=" + encodeURIComponent("/"),
        { headers: { Authorization: "Bearer " + token } }
      );
      let json: any;
      try { json = await res.json(); } catch {
        const text = await res.text().catch(() => "");
        setTestResult("\u274c Edge Function \u5f02\u5e38 (" + res.status + "): " + text.slice(0, 200));
        setTesting(false); return;
      }
      if (json.error) {
        setTestResult("\u274c " + json.error + (json.hint ? " | " + json.hint : ""));
      } else {
        setTestResult("\u2705 \u8fde\u63a5\u6210\u529f | " + form.url + " | \u627e\u5230 " + (json.files?.length ?? 0) + " \u4e2a\u6587\u4ef6/\u76ee\u5f55");
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setTestResult("\u274c \u4ee3\u7406\u8bf7\u6c42\u5931\u8d25: " + err.message);
    }
    setTesting(false);
  };  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-4">
      <h2 className="font-semibold text-lg">WebDAV 配置</h2>
      <p className="text-sm text-gray-400">夸克网盘 → 设置 → WebDAV 获取连接信息</p>
      <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-400 mb-1 block">WebDAV 地址</label><input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" placeholder="https://webdav.quark.cn" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          <div><label className="text-xs text-gray-400 mb-1 block">用户名</label><input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" placeholder="手机号" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div><label className="text-xs text-gray-400 mb-1 block">密码 (应用密码)</label><input type="password" className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm" placeholder="夸克生成的专用密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={testConnection} disabled={!form.url || testing} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">{testing ? "测试中..." : "测试连接"}</button>
          <button onClick={() => addMutation.mutate(form)} disabled={!form.url || !form.username || !form.password} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">保存配置</button>
        </div>
        {testResult && <p className="text-sm">{testResult}</p>}
      </div>
      {configs?.map((c) => (<div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800"><div><span className="font-medium text-sm">{c.name}</span><span className="ml-3 text-xs text-gray-400 truncate max-w-[300px]">{c.url}</span>{c.is_active && <span className="ml-2 text-xs text-emerald-500">● 已激活</span>}</div><button onClick={() => deleteMutation.mutate(c.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></div>))}
    </div>
  );
}

// ============================================================

function AiConfigPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const { data: config } = useQuery({
    queryKey: ["ai-config"],
    queryFn: async () => {
      const { data } = await supabase.from("ai_configs").select("*").maybeSingle();
      return data as {
        id?: string; provider: string;
        api_key: string; base_url: string; chat_model: string;
        embed_api_key: string | null; embed_base_url: string | null; embed_model: string;
      } | null;
    },
  });
  const [form, setForm] = useState({
    provider: "custom",
    api_key: "", base_url: "https://api.openai.com/v1", chat_model: "gpt-4o-mini",
    embed_api_key: "", embed_base_url: "", embed_model: "text-embedding-3-small",
  });
  useEffect(() => {
    if (config) setForm({
      provider: config.provider || "custom",
      api_key: config.api_key || "",
      base_url: config.base_url || "https://api.openai.com/v1",
      chat_model: config.chat_model || "gpt-4o-mini",
      embed_api_key: config.embed_api_key || "",
      embed_base_url: config.embed_base_url || "",
      embed_model: config.embed_model || "text-embedding-3-small",
    });
  }, [config]);

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const p = { ...form };
      let result;
      if (config?.id) {
        result = await supabase.from("ai_configs").update(p).eq("id", config.id);
      } else {
        result = await supabase.from("ai_configs").insert({ user_id: user?.id, ...p });
      }
      if (result.error) {
        setMsg("❌ 保存失败: " + result.error.message);
      } else {
        queryClient.invalidateQueries({ queryKey: ["ai-config"] });
        setMsg("✅ 保存成功");
      }
    } catch (e) {
      setMsg("❌ 保存异常: " + (e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  };

  // 测试对话 API
  const testChat = async () => {
    setTesting(true); setMsg("");
    try {
      const url = form.base_url.replace(/\/$/, "") + "/chat/completions";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + form.api_key },
        body: JSON.stringify({ model: form.chat_model, messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),
      });
      if (res.ok) setMsg("✅ 对话API 连接成功");
      else { const err = await res.text().catch(() => ""); setMsg("❌ 对话API 失败 (" + res.status + ")" + (err ? ": " + err.slice(0, 100) : "")); }
    } catch (e) { setMsg("❌ 对话API 无法连接: " + (e instanceof Error ? e.message : "")); }
    setTesting(false);
  };

  // 测试向量 API
  const testEmbed = async () => {
    setTesting(true); setMsg("");
    try {
      const key = form.embed_api_key || form.api_key;
      const base = form.embed_base_url || form.base_url;
      const url = base.replace(/\/$/, "") + "/embeddings";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: form.embed_model, input: "test" }),
      });
      if (res.ok) setMsg("✅ 向量API 连接成功");
      else { const err = await res.text().catch(() => ""); setMsg("❌ 向量API 失败 (" + res.status + ")" + (err ? ": " + err.slice(0, 100) : "")); }
    } catch (e) { setMsg("❌ 向量API 无法连接: " + (e instanceof Error ? e.message : "")); }
    setTesting(false);
  };

  const quickSet = (p: { provider: string; base_url: string; chat_model: string; embed_model: string; embed_base_url?: string }) => {
    setForm({ ...form, provider: p.provider, base_url: p.base_url, chat_model: p.chat_model, embed_model: p.embed_model, embed_base_url: p.embed_base_url || "", embed_api_key: "" });
  };

  const vendors = [
    { name: "OpenAI",     provider: "openai",     base_url: "https://api.openai.com/v1",                  chat_model: "gpt-4o-mini",           embed_model: "text-embedding-3-small" },
    { name: "DeepSeek",   provider: "deepseek",   base_url: "https://api.deepseek.com/v1",               chat_model: "deepseek-chat",         embed_model: "text-embedding-3-small" },
    { name: "智谱AI",     provider: "zhipu",      base_url: "https://open.bigmodel.cn/api/paas/v4",      chat_model: "glm-4-flash",           embed_model: "embedding-3" },
    { name: "阿里百炼",   provider: "aliyun",     base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", chat_model: "qwen-plus",     embed_model: "text-embedding-v4" },
    { name: "硅基流动",   provider: "siliconflow",base_url: "https://api.siliconflow.cn/v1",             chat_model: "Qwen/Qwen2.5-7B-Instruct", embed_model: "BAAI/bge-large-zh-v1.5" },
    { name: "Ollama",     provider: "ollama",     base_url: "http://localhost:11434/v1",                 chat_model: "qwen2.5:7b",            embed_model: "nomic-embed-text" },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-6">
      <h2 className="font-semibold text-lg flex items-center gap-2"><Cpu className="w-5 h-5 text-primary-500" />AI 供应商配置</h2>

      {/* 供应商快捷选择 */}
      <div className="flex flex-wrap gap-2">
        {vendors.map((p) => (
          <button key={p.provider} onClick={() => quickSet(p)}
            className={"px-3 py-1.5 rounded-lg text-xs font-medium border " + (
              form.provider === p.provider
                ? "bg-primary-600 text-white border-primary-600"
                : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-primary-400"
            )}>{p.name}</button>
        ))}
        <button onClick={() => setForm({ ...form, provider: "custom" })}
          className={"px-3 py-1.5 rounded-lg text-xs font-medium border " + (
            form.provider === "custom" ? "bg-primary-600 text-white border-primary-600" : "bg-gray-50 dark:bg-gray-800"
          )}>自定义</button>
      </div>

      {/* ─── 对话配置 ─────────────────────────────────────── */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-gray-500 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> 对话配置
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">API 密钥 *</label>
            <input type="password" className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm font-mono" placeholder="sk-xxx"
              value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">API 端点</label>
            <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm font-mono"
              value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">对话模型</label>
            <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm font-mono"
              value={form.chat_model} onChange={(e) => setForm({ ...form, chat_model: e.target.value })} />
          </div>
        </div>
        <button onClick={testChat} disabled={!form.api_key || testing}
          className="px-3 py-1.5 border rounded-lg text-xs hover:bg-white dark:hover:bg-gray-700 disabled:opacity-50">
          {testing ? "测试中..." : "测试对话连接"}
        </button>
      </div>

      {/* ─── 向量配置 ─────────────────────────────────────── */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-gray-500 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 向量配置 <span className="text-xs text-gray-400 font-normal">(留空则使用对话配置)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">向量 API 密钥</label>
            <input type="password" className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm font-mono" placeholder="留空使用上方密钥"
              value={form.embed_api_key} onChange={(e) => setForm({ ...form, embed_api_key: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">向量 API 端点</label>
            <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm font-mono" placeholder="留空使用上方端点"
              value={form.embed_base_url} onChange={(e) => setForm({ ...form, embed_base_url: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">向量模型</label>
            <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm font-mono"
              value={form.embed_model} onChange={(e) => setForm({ ...form, embed_model: e.target.value })} />
          </div>
        </div>
        <button onClick={testEmbed} disabled={(!form.api_key && !form.embed_api_key) || testing}
          className="px-3 py-1.5 border rounded-lg text-xs hover:bg-white dark:hover:bg-gray-700 disabled:opacity-50">
          {testing ? "测试中..." : "测试向量连接"}
        </button>
      </div>

      {/* ─── 操作按钮 ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={!form.api_key || saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {saving ? "保存中..." : config?.id ? "更新配置" : "保存配置"}
        </button>
        {msg && <span className={"text-sm " + (msg.includes("✅") ? "text-emerald-600" : "text-red-500")}>{msg}</span>}
      </div>
      <p className="text-xs text-gray-400">💡 向量配置为空时自动回退到对话配置。密钥安全存储在 Supabase 数据库中，仅 Edge Function 可通过 service_role 读取。</p>
    </div>
  );
}
