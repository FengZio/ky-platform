import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { backendFetch } from "@/lib/backend";
import { LearningMaterial, Subject } from "@/types";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Search, FileText, Video, FileQuestion, StickyNote, FolderOpen, HardDrive, FolderOpenDot, ChevronLeft, RefreshCw } from "lucide-react";

const TYPE_ICONS: Record<string, typeof FileText> = {
  video: Video,
  document: FileText,
  exercise: FileQuestion,
  note: StickyNote,
  other: FileText,
};

const TYPE_LABELS: Record<string, string> = {
  video: "视频",
  document: "文档",
  exercise: "习题",
  note: "笔记",
  other: "其他",
};

export default function Materials({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: materials, isLoading } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_materials")
        .select("*, subjects(id, name, color)")
        .order("created_at", { ascending: false });
      return data as (LearningMaterial & {
        subjects: Pick<Subject, "id" | "name" | "color"> | null;
      })[];
    },
  });

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data } = await supabase.from("subjects").select("*");
      return data as Subject[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => supabase.from("learning_materials").delete().eq("id", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["materials"] }),
  });

  const linkMutation = useMutation({
    mutationFn: async ({ materialId, subjectId }: { materialId: string; subjectId: string | null }) => {
      const { error } = await supabase
        .from("learning_materials")
        .update({ subject_id: subjectId })
        .eq("id", materialId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.refetchQueries({ queryKey: ["materials"] }),
  });

  const filtered = materials?.filter((m) => {
    if (filter !== "all" && m.type !== filter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className={embedded ? "space-y-6" : "max-w-4xl mx-auto space-y-6"}>
      <div className="flex items-center justify-between">
        {embedded ? (
          <h2 className="text-lg font-semibold">学习资料</h2>
        ) : (
          <h1 className="text-2xl font-bold">学习资料</h1>
        )}
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
        >
          <Plus className="w-4 h-4" />
          添加资料
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm"
            placeholder="搜索资料..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {["all", "video", "document", "exercise", "note"].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm transition-colors",
              filter === t
                ? "bg-primary-600 text-white"
                : "bg-white dark:bg-gray-900 border text-gray-600 hover:bg-gray-50"
            )}
          >
            {t === "all" ? "全部" : TYPE_LABELS[t]}
          </button>
        ))}
      </div>


      {/* WebDAV Browser */}
      <WebdavBrowser />
      {/* Form */}
      {showForm && (
        <MaterialForm
          subjects={subjects ?? []}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["materials"] });
          }}
        />
      )}

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : filtered && filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((m) => {
            const Icon = TYPE_ICONS[m.type] ?? FileText;
            return (
              <div
                key={m.id}
                className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border hover:border-primary-300 transition-colors"
              >
                <Icon className="w-8 h-8 text-primary-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{m.title}</h4>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    <span>{TYPE_LABELS[m.type]}</span>
                    {m.file_type && <span>· {m.file_type}</span>}
                    {m.duration_minutes && <span>· {m.duration_minutes}分钟</span>}
                    {m.subjects && <span>· {m.subjects.name}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 max-w-[220px]">
                  <select
                    className="text-xs px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800 w-[120px]"
                    value={m.subject_id ?? ""}
                    onChange={(e) => linkMutation.mutate({ materialId: m.id, subjectId: e.target.value || null })}
                  >
                    <option value="">未关联科目</option>
                    {subjects?.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(m.id)}
                  className="p-1 text-gray-400 hover:text-red-500 flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>还没有学习资料，添加你的夸克网盘文件吧</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 添加资料表单
// ============================================================
function MaterialForm({
  subjects,
  onClose,
  onSaved,
}: {
  subjects: Subject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    title: "",
    type: "document" as LearningMaterial["type"],
    webdav_path: "",
    file_type: "",
    subject_id: "",
    notes: "",
    duration_minutes: "", file_size: "" as string | number,
  });

  const mutation = useMutation({
    mutationFn: async (f: typeof form) => {
      const { error } = await supabase.from("learning_materials").insert({
        uploaded_by: user?.id,
        title: f.title,
        type: f.type,
        webdav_path: f.webdav_path,
        file_type: f.file_type || null,
        subject_id: f.subject_id || null,
        notes: f.notes || null,
        duration_minutes: f.duration_minutes ? parseInt(f.duration_minutes) : null, file_size: f.file_size ? parseInt(f.file_size as string) : null,
      });
      if (error) throw error;
    },
    onSuccess: onSaved,
  });

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-4">
      <h3 className="font-medium text-sm text-gray-500">添加学习资料</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <input
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            placeholder="资料名称 *  如: 张宇高数基础班-第1讲"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">类型</label>
          <div className="flex gap-1">
            {(["video", "document", "exercise", "note"] as const).map((t) => (
              <button
                key={t}
                className={cn(
                  "px-3 py-1.5 rounded text-xs",
                  form.type === t
                    ? "bg-primary-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500"
                )}
                onClick={() => setForm({ ...form, type: t })}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">关联科目</label>
          <select
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            value={form.subject_id}
            onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
          >
            <option value="">请选择科目</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">文件类型</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            placeholder="mp4 / pdf / docx"
            value={form.file_type}
            onChange={(e) => setForm({ ...form, file_type: e.target.value })}
          />
        </div>
        {form.type === "video" && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">时长(分钟)</label>
            <input
              type="number"
              className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
              placeholder="60"
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">WebDAV 路径</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm font-mono"
            placeholder="/courses/高数/01-函数极限.mp4"
            value={form.webdav_path}
            onChange={(e) => setForm({ ...form, webdav_path: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <textarea
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            rows={2}
            placeholder="备注 (可选)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">取消</button>
        <button
          disabled={!form.title || !form.subject_id}
          onClick={() => mutation.mutate(form)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          添加
        </button>
      </div>
    </div>
  );
}


// ============================================================
// WebDAV 文件浏览器
// ============================================================
interface WebdavFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: string;
  contentType: string;
}

function WebdavBrowser() {
  const { user } = useAuth();
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<WebdavFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configName, setConfigName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [importSubjectId, setImportSubjectId] = useState("");

  const { data: configs, error: wdError } = useQuery({
    queryKey: ["webdav-configs"],
    queryFn: async () => {
      const { data } = await supabase.from("webdav_configs").select("*").eq("is_active", true).limit(1);
      return data;
    },
  });

  const hasConfig = configs && configs.length > 0;

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data } = await supabase.from("subjects").select("*").order("sort_order");
      return data as Subject[];
    },
  });

  const browse = async (path: string) => {
    if (!hasConfig) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/webdav-proxy?path=" + encodeURIComponent(path.startsWith("/") ? path : "/" + path);
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      let json: any;
      try { json = await res.json(); } catch {
        const text = await res.text().catch(() => "");
        setError("Edge Function \u5f02\u5e38 (" + res.status + "): " + text.slice(0, 300));
        setFiles([]); setLoading(false); return;
      }
      if (json.error) {
        const msg = json.error + (json.hint ? " | " + json.hint : "") + " | path: " + path;
        console.error("WebDAV:", msg);
        setError(msg);
        setFiles([]);
      } else {
        setFiles(json.files ?? []);
        setConfigName(json.configName ?? "");
        setCurrentPath(json.path ?? path);
        if (json.debug) console.log("WebDAV debug:", json.debug);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError("\u8bf7\u6c42\u5931\u8d25: " + (err.message || JSON.stringify(err)));
    }
    setLoading(false);
  };

useEffect(() => { if (hasConfig) browse("/"); }, [hasConfig]);

  const navigateTo = (file: WebdavFile) => {
    if (file.isDirectory) browse(file.path);
  };

  const goUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    browse("/" + parts.join("/"));
  };

  const addSelectedAsMaterials = async () => {
    if (!importSubjectId) {
      setError("请先选择要关联的科目");
      return;
    }
    const selected = files.filter((f) => selectedFiles.has(f.path) && !f.isDirectory);
    for (const f of selected) {
      const ext = f.name.split(".").pop()?.toLowerCase();
      const type = ext === "mp4" || ext === "mov" || ext === "avi" ? "video"
        : ext === "pdf" ? "document"
        : ext === "docx" || ext === "doc" ? "document"
        : ext === "md" ? "note"
        : "other";
      await supabase.from("learning_materials").insert({
        uploaded_by: user?.id,
        title: f.name,
        type,
        webdav_path: f.path,
        webdav_config_id: configs?.[0]?.id ?? null,
        subject_id: importSubjectId,
        file_type: ext ?? null,
        file_size: f.size,
        source: configName || "夸克WebDAV",
      });
    }
    queryClient.invalidateQueries({ queryKey: ["materials"] });
    setSelectedFiles(new Set());
  };

  const queryClient = useQueryClient();
  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  if (!hasConfig) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
        <HardDrive className="w-4 h-4" />
        尚未配置 WebDAV，请先在「设置」中连接夸克网盘
      </div>
    );
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "-";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FolderOpenDot className="w-4 h-4 text-primary-500" />
          {configName} <span className="text-gray-400 font-mono text-xs">{currentPath}</span>
        </h3>
        <div className="flex gap-2">
          <button onClick={() => browse(currentPath)} className="p-1 text-gray-400 hover:text-gray-600" title="刷新">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Navigation */}
      {currentPath !== "/" && (
        <button onClick={goUp} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600">
          <ChevronLeft className="w-3.5 h-3.5" /> 上级目录
        </button>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 py-4">加载中...</p>
      ) : files.length > 0 ? (
        <>
          {/* Select all */}
          {files.some((f) => !f.isDirectory) && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const all = files.filter((f) => !f.isDirectory);
                  if (selectedFiles.size === all.length) setSelectedFiles(new Set());
                  else setSelectedFiles(new Set(all.map((f) => f.path)));
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {selectedFiles.size === files.filter((f) => !f.isDirectory).length ? "取消全选" : "全选文件"}
              </button>
              {selectedFiles.size > 0 && (
                <>
                  <select
                    className="text-xs px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800"
                    value={importSubjectId}
                    onChange={(e) => setImportSubjectId(e.target.value)}
                  >
                    <option value="">选择科目</option>
                    {subjects?.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={addSelectedAsMaterials}
                    disabled={!importSubjectId}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium disabled:opacity-40 disabled:hover:text-primary-600"
                  >
                    导入选中 ({selectedFiles.size})
                  </button>
                </>
              )}
            </div>
          )}

          {/* File list */}
          <div className="space-y-1 max-h-64 overflow-auto">
            {/* Directories first */}
            {files.filter((f) => f.isDirectory).map((f) => (
              <button
                key={f.path}
                onClick={() => navigateTo(f)}
                className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-left"
              >
                <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
            {/* Files */}
            {files.filter((f) => !f.isDirectory).map((f) => (
              <label
                key={f.path}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedFiles.has(f.path)}
                  onChange={() => toggleFile(f.path)}
                  className="w-4 h-4 rounded accent-primary-600 flex-shrink-0"
                />
                {f.contentType?.startsWith("video") ? <Video className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  : f.name.endsWith(".pdf") ? <FileText className="w-4 h-4 text-red-400 flex-shrink-0" />
                  : <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(f.size)}</span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-400 py-4 text-center">此目录为空</p>
      )}
    </div>
  );
}


// ============================================================
// 任务解析面板 — 提交 + 轮询
// ============================================================
function TaskParser() {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState<string | null>(null);

  // 从后端 API 拉取所有任务（持久化队列，刷新不丢失）
  const { data: allTasks, refetch: refetchTasks } = useQuery({
    queryKey: ["parse-tasks"],
    queryFn: async () => {
      const res = await backendFetch("/api/tasks?limit=30");
      if (!res.ok) return [];
      const json = await res.json();
      return json as {
        task_id: string;
        material_id: string;
        material_title: string;
        status: string;
        progress_pct: number;
        message?: string;
        created_at: string;
      }[];
    },
    refetchInterval: 5000, // 每 5 秒自动刷新
  });

  const { data: materials } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data } = await supabase.from("learning_materials").select("id, title, embedding, content");
      return data as { id: string; title: string; embedding: number[] | null; content: string | null }[];
    },
  });

  // 有活跃任务的 material_id 集合
  const activeMaterialIds = new Set(
    (allTasks ?? []).filter(t => t.status !== "done" && t.status !== "failed").map(t => t.material_id)
  );

  // 未解析: 没有 content 且没有活跃任务
  const unparsed = materials?.filter(
    (m) => !m.content && !activeMaterialIds.has(m.id)
  ) ?? [];

  // 任务队列: 活跃任务 + 最近完成/失败的任务
  const activeTasks = (allTasks ?? []).filter(t => t.status !== "done" && t.status !== "failed");
  const recentDone = (allTasks ?? []).filter(t => t.status === "done" || t.status === "failed").slice(0, 3);

  if (activeTasks.length === 0 && recentDone.length === 0 && unparsed.length === 0) return null;

  const submitTask = async (materialId: string) => {
    setSubmitting(materialId);
    try {
      const res = await backendFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_id: materialId }),
      });
      const text = await res.text();
      console.log("[TaskParser] POST response status:", res.status, "body:", text);
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
      if (json.task_id) {
        refetchTasks(); // 立即刷新任务列表
      } else if (json.detail) {
        alert("提交失败: " + json.detail);
      } else {
        alert("提交异常 (HTTP " + res.status + ")，请查看控制台日志");
        // 即使响应不正常，也尝试刷新（后端可能已入库）
        refetchTasks();
      }
    } catch (e) {
      alert("网络请求失败: " + (e instanceof Error ? e.message : ""));
    }
    setSubmitting(null);
  };

  const statusLabels: Record<string, string> = {
    queued: "排队中",
    downloading: "下载中",
    uploading: "上传中",
    parsing: "MinerU 解析中",
    chunking: "分块中",
    embedding: "向量化中",
    done: "✅ 完成",
    failed: "❌ 失败",
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-gray-500">📄 文档解析队列</h3>
        {activeTasks.length > 0 && (
          <span className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">
            {activeTasks.length} 个任务进行中
          </span>
        )}
      </div>

      {/* Active tasks queue */}
      {activeTasks.map((task) => (
        <div key={task.task_id} className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">
                {task.material_title || task.material_id?.slice(0, 8) || "—"}
              </p>
              <span className="text-xs text-amber-600 flex-shrink-0">
                {statusLabels[task.status] || task.status}
              </span>
            </div>
            <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-2 mt-1.5">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-700"
                style={{ width: task.progress_pct + "%" }}
              />
            </div>
            {task.message && <p className="text-xs text-red-500 mt-1 truncate">{task.message}</p>}
          </div>
          <span className="text-xs text-amber-500 font-mono flex-shrink-0">{task.progress_pct}%</span>
        </div>
      ))}

      {/* Recently completed/failed */}
      {recentDone.length > 0 && activeTasks.length === 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-400">最近完成</p>
          {recentDone.map((task) => (
            <div key={task.task_id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm">
              <span className="truncate flex-1">{task.material_title || task.material_id?.slice(0, 8) || "—"}</span>
              <span className={task.status === "done" ? "text-emerald-600 text-xs" : "text-red-500 text-xs"}>
                {statusLabels[task.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Unparsed materials */}
      {unparsed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">{unparsed.length} 份资料待解析</p>
          {unparsed.slice(0, 5).map((m) => (
            <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
              <span className="text-sm truncate flex-1 mr-2">{m.title}</span>
              <button
                onClick={() => submitTask(m.id)}
                disabled={submitting === m.id}
                className="px-3 py-1 rounded text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex-shrink-0"
              >
                {submitting === m.id ? "提交中..." : "⚡ 解析"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

