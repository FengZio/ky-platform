import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { LearningMaterial, Subject, KnowledgePoint } from "@/types";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Search, FileText, Video, FileQuestion, StickyNote, FolderOpen, Link2, HardDrive, FolderOpenDot, ChevronLeft, Download, Sparkles, Zap } from "lucide-react";

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

export default function Materials() {
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
        .select("*, material_knowledge_points(kp_id, knowledge_points(id, name)), subjects(name)")
        .order("created_at", { ascending: false });
      return data as (LearningMaterial & {
        material_knowledge_points: { kp_id: string; knowledge_points: { id: string; name: string } | null }[];
        subjects: { name: string } | null;
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

  const { data: knowledgePoints } = useQuery({
    queryKey: ["knowledge-points"],
    queryFn: async () => {
      const { data } = await supabase.from("knowledge_points").select("id, name");
      return data as Pick<KnowledgePoint, "id" | "name">[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => supabase.from("learning_materials").delete().eq("id", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["materials"] }),
  });

  const linkMutation = useMutation({
    mutationFn: async ({ materialId, kpId, action }: { materialId: string; kpId: string; action: string }) => {
      if (action === "unlink") {
        await supabase.from("material_knowledge_points").delete().eq("material_id", materialId).eq("kp_id", kpId);
      } else {
        await supabase.from("material_knowledge_points").upsert({ material_id: materialId, kp_id: kpId, source: "manual" }, { onConflict: "material_id,kp_id" });
      }
    },
    onSuccess: () => queryClient.refetchQueries({ queryKey: ["materials"] }),
  });

  const filtered = materials?.filter((m) => {
    if (filter !== "all" && m.type !== filter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">学习资料</h1>
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


      {/* AI Matching */}
      <AiMatcher />
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


                {/* Linked knowledge points */}
                <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
                  {(m as any).material_knowledge_points?.map((mkp: any) => (
                    <span key={mkp.kp_id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700">
                      {mkp.knowledge_points?.name?.slice(0, 8)}
                      <button
                        onClick={() => linkMutation.mutate({ materialId: m.id, kpId: mkp.kp_id, action: "unlink" })}
                        className="ml-0.5 text-indigo-400 hover:text-red-500"
                      >×</button>
                    </span>
                  ))}
                  <select
                    className="text-xs px-1 py-0.5 rounded border bg-gray-50 dark:bg-gray-800 w-[80px]"
                    value=""
                    onChange={(e) => { if (e.target.value) linkMutation.mutate({ materialId: m.id, kpId: e.target.value, action: "link" }); }}
                  >
                    <option value="">+关联</option>
                    {knowledgePoints?.filter(kp => !(m as any).material_knowledge_points?.some((mkp: any) => mkp.kp_id === kp.id)).map((kp) => (
                      <option key={kp.id} value={kp.id}>{kp.name.slice(0, 10)}</option>
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
            <option value="">不关联</option>
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
          disabled={!form.title}
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

  const { data: configs, error: wdError } = useQuery({
    queryKey: ["webdav-configs"],
    queryFn: async () => {
      const { data } = await supabase.from("webdav_configs").select("*").eq("is_active", true).limit(1);
      return data;
    },
  });

  const hasConfig = configs && configs.length > 0;

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
                <button onClick={addSelectedAsMaterials} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                  导入选中 ({selectedFiles.size})
                </button>
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

import { RefreshCw } from "lucide-react";



// ============================================================
// AI 智能匹配
// ============================================================

function AiMatcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [matching, setMatching] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<{
    material_id: string;
    material_title: string;
    kp_id: string;
    kp_name: string;
    match_score: number;
    chunk_content?: string;
  }[]>([]);
  const [alternatives, setAlternatives] = useState<Record<string, typeof results>>({});
  const [similarResults, setSimilarResults] = useState<Record<string, { chunk_id: string; chunk_content: string; material_title: string; match_score: number; knowledge_tags: string[]; match_method: string }[]>>({});
  const [loadingSimilar, setLoadingSimilar] = useState<string | null>(null);

  const [subjectFilter, setSubjectFilter] = useState<string[]>([]);

  const { data: materials } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data } = await supabase.from("learning_materials").select("id, title, embedding");
      return data as { id: string; title: string; embedding: number[] | null }[];
    },
  });

  // 已向量化的知识点 (不拉取 embedding 列, 节省 ~1.8MB/次)
  const { data: embeddedKps } = useQuery({
    queryKey: ["knowledge-points-embedded"],
    queryFn: async () => {
      const { data } = await supabase.from("knowledge_points").select("id, name, subject_id").not("embedding", "is", null);
      return data as { id: string; name: string; subject_id: string | null }[];
    },
  });

  // 未向量化的知识点
  const { data: unembeddedKps } = useQuery({
    queryKey: ["knowledge-points-unembedded"],
    queryFn: async () => {
      const { data } = await supabase.from("knowledge_points").select("id, name, subject_id").is("embedding", null);
      return data as { id: string; name: string; subject_id: string | null }[];
    },
  });


  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data } = await supabase.from("subjects").select("id, name");
      return data as { id: string; name: string }[];
    },
  });

  const allMaterials = materials ?? [];
  const linked = materials?.filter((m) => m.embedding !== null) ?? [];
  const unembeddedKpsList = unembeddedKps ?? [];
  const embeddedKpsList = embeddedKps ?? [];
  const allKps = [...(embeddedKps ?? []), ...(unembeddedKps ?? [])];
  const filteredKps = subjectFilter.length > 0 ? allKps.filter(kp => subjectFilter.includes(kp.subject_id ?? "")) : allKps;
  const unlinked = allMaterials.filter((m) => m.embedding === null);

    // 客户端下载 PDF → 浏览器提取文本 → 发送到 parse-document 分块+向量化
  const parseDocument = async (materialId: string) => {
    setMatching(true);
    setProgress("正在获取资料信息...");
    try {
      const { data: mat } = await supabase.from("learning_materials").select("*").eq("id", materialId).maybeSingle();
      if (!mat) { setProgress("❌ 资料不存在"); setMatching(false); return; }

      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3456";
      const fileExt = (mat.webdav_path as string || "").split(".").pop()?.toLowerCase() ?? "";
      const isPdf = mat.file_type === "pdf" || fileExt === "pdf";

      const body: Record<string, unknown> = { material_id: materialId };

      if (isPdf && mat.webdav_path) {
        setProgress("正在发送到后端处理 PDF (下载+解析+向量化)...");
        body.webdav_path = mat.webdav_path;
      } else if (mat.content) {
        setProgress("正在发送文本到后端分块向量化...");
        body.text = mat.content;
      }

      console.log("[parseDocument] Sending to:", backendUrl + "/api/tasks", "body:", body);
      const res = await fetch(backendUrl + "/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      console.log("[parseDocument] Response status:", res.status);
      const json = await res.json();
      console.log("[parseDocument] Response body:", json);
      if (json.task_id) {
        // 任务式接口: 已提交后台队列，由 TaskParser 轮询进度
        queryClient.invalidateQueries({ queryKey: ["parse-tasks"] });
        setProgress("✅ 已加入解析队列 (task: " + (json.task_id as string).slice(0, 8) + ")，请等待完成");
      } else if (json.success) {
        // 兼容旧同步接口
        queryClient.invalidateQueries({ queryKey: ["materials"] });
        queryClient.invalidateQueries({ queryKey: ["knowledge-points-embedded"] }); queryClient.invalidateQueries({ queryKey: ["knowledge-points-unembedded"] });
        setProgress("✅ 解析完成: " + (json.text_length ?? "?") + " 字 → " + (json.chunks_total ?? "?") + " 块 → " + (json.chunks_embedded ?? "?") + " 块已向量化");
      } else {
        setProgress("❌ " + (json.detail || json.error || "未知错误"));
      }
    } catch (e) { setProgress("❌ 请求失败: " + (e instanceof Error ? e.message : "")); }
    setMatching(false);
    setTimeout(() => setProgress(""), 5000);
  };const generateKpEmbedding = async (kpId: string) => {
    setMatching(true);
    setProgress("正在生成知识点向量...");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const { data: kp } = await supabase.from("knowledge_points").select("*").eq("id", kpId).maybeSingle();
      if (!kp) { setProgress(""); setMatching(false); return; }

      const res = await fetch(import.meta.env.VITE_SUPABASE_URL + "/functions/v1/generate-embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ table: "knowledge_points", record: kp }),
      });
      const json = await res.json();
      if (json.success) {
        queryClient.invalidateQueries({ queryKey: ["knowledge-points-embedded"] }); queryClient.invalidateQueries({ queryKey: ["knowledge-points-unembedded"] });
        setProgress("✅ 知识点向量生成成功");
      } else {
        setProgress("❌ " + (json.error || "未知错误"));
      }
    } catch (e) { setProgress("❌ 请求失败: " + (e instanceof Error ? e.message : "")); }
    setMatching(false);
    setTimeout(() => setProgress(""), 3000);
  };

  // 批量向量化 (带 2 秒 API 间隔，适配免费额度)
  const batchVectorize = async (type: "materials" | "kps") => {
    if (!user?.id) return;
    setMatching(true);
    const list = type === "materials" ? allMaterials.filter(m => !m.embedding) : unembeddedKpsList;
    if (list.length === 0) { setMatching(false); return; }
    const total = list.length;
    const label = type === "materials" ? "资料" : "知识点";
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const DELAY_MS = 2000; // 免费 API 间隔
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const itemName = ((item as any).title || (item as any).name || "").slice(0, 20);
      setProgress((type === "materials" ? "正在解析 " : "正在向量化 ") + label + " (" + (i + 1) + "/" + total + "): " + itemName);
      try {
        // 资料用 parse-document (分块向量化), 知识点用 generate-embedding
        if (type === "materials") {
          const res = await fetch((import.meta.env.VITE_BACKEND_URL || "http://localhost:3456") + "/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ material_id: item.id }),
          });
          const json = await res.json();
          if (json.task_id) {
            console.log("[batchVectorize] task submitted:", json.task_id);
          } else {
            console.error("[batchVectorize] parse failed:", item.id, json.detail || json.error);
          }
        } else {
          const table = "knowledge_points";
          const { data: full } = await supabase.from(table).select("*").eq("id", item.id).maybeSingle();
          if (!full) continue;
          const res = await fetch(import.meta.env.VITE_SUPABASE_URL + "/functions/v1/generate-embedding", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ table, record: full }),
          });
          const json = await res.json();
          if (!json.success) console.error("vectorize failed:", item.id, json.error);
        }
      } catch (e) { console.error("vectorize error:", e); }
      // API 间隔 (最后一项不用等)
      if (i < list.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
    }
    setProgress("✅ 完成: " + total + " 个" + label + (type === "materials" ? "已解析" : "已向量化"));
    queryClient.invalidateQueries({ queryKey: ["materials"] });
    queryClient.invalidateQueries({ queryKey: ["knowledge-points-embedded"] }); queryClient.invalidateQueries({ queryKey: ["knowledge-points-unembedded"] });
    setMatching(false);
    setTimeout(() => setProgress(""), 5000);
  };

  const runMatching = async () => {
    if (!user?.id) { setProgress("❌ 未登录"); return; }
    if (embeddedKpsList.length === 0) { setProgress("⚠ 请先为知识点生成向量"); return; }
    setMatching(true);
    setProgress("正在智能匹配知识点...");
    try {
      const { data, error } = await supabase.rpc("match_materials_to_knowledge_points", { p_material_id: null, p_limit: 500, p_min_score: 0.6 });
      if (error) {
        setProgress("❌ 匹配失败: " + error.message);
      } else if (data && data.length > 0) {
        setResults(data as typeof results);
        setProgress("✅ 匹配完成, 找到 " + data.length + " 条关联");
      } else {
        setProgress("⚠ 未找到匹配结果, 请先为资料生成向量");
      }
    } catch (e) { setProgress("❌ 匹配异常: " + (e instanceof Error ? e.message : "")); }
    setMatching(false);
    setTimeout(() => setProgress(""), 5000);
  };

  const linkKp = async (materialId: string, kpId: string, chunkId?: string) => {
    await supabase.from("material_knowledge_points").upsert({
      material_id: materialId, kp_id: kpId, chunk_id: chunkId || null, source: "manual"
    }, { onConflict: "material_id,kp_id" });
    queryClient.invalidateQueries({ queryKey: ["materials"] });
  };

  const loadSimilar = async (chunkId: string, key: string) => {
    setLoadingSimilar(key);
    try {
      const { data, error } = await supabase.rpc("find_similar_questions", {
        p_chunk_id: chunkId,
        p_limit: 5,
        p_min_score: 0.6,
      });
      if (!error && data) {
        setSimilarResults(prev => ({ ...prev, [key]: data }));
      }
    } catch { /* ignore */ }
    setLoadingSimilar(null);
  };
  const aiReviewOne = async (r: { material_id: string; kp_id: string; material_title: string; kp_name: string; chunk_content?: string }) => {
    setProgress("AI 审核中 (共 " + (filteredKps.length ?? 0) + " 个知识点)...");
    setMatching(true);
    try {
      const kps = filteredKps;
      if (kps.length === 0) { setProgress("⚠ 没有知识点可供筛选"); setMatching(false); return; }

      // 用纯数字编号 + 名称，不显示 UUID 避免干扰 AI
      const kpList = kps.map((kp, i) => (i + 1) + ". " + kp.name).join("\n");
      const systemMsg = "你是一个精确的分类器。你的任务只有一个: 从知识点列表中选出最匹配的编号。\\n规则:\\n1. 只输出一个整数数字 (如 3 或 0)，不要输出任何其他字符\\n2. 如果内容明确属于某个知识点，输出该知识点的编号\\n3. 如果不确定或不匹配任何知识点，输出 0\\n\\n示例正确回复: 3\\n示例正确回复: 0\\n\\n注意: 不要输出解释、分析、标点、空格。只输出数字本身。";
      const userMsg = "知识点列表:\n" + kpList + "\n\n学习内容:\n\"" + r.chunk_content?.slice(0, 500) + "\"\n\n最匹配的知识点编号:";

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(import.meta.env.VITE_SUPABASE_URL + "/functions/v1/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session?.access_token },
        body: JSON.stringify({ messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ] }),
      });
      const json = await res.json();
      // 检查 Edge Function 是否返回了错误
      if (json.error) {
        setProgress("❌ AI 审核失败: " + json.error);
        setMatching(false);
        setTimeout(() => setProgress(""), 8000);
        return;
      }
      const rawAnswer = (json.reply || json.content || "").trim();
      console.log("[AI Review] raw:", rawAnswer, "debug:", JSON.stringify(json.debug || {}));
      // 如果回复为空但 Edge Function 有调试信息，展示给用户
      if (!rawAnswer && json.debug) {
        setProgress("⚠ AI 回复为空 (model: " + json.debug.model + ", choices: " + json.debug.choicesCount + ")，可能 max_tokens 过小或模型未遵守指令");
        setMatching(false);
        setTimeout(() => setProgress(""), 8000);
        return;
      }

      // 提取第一个数字作为编号
      const match = rawAnswer.match(/\d+/);
      const pickedIdx = match ? parseInt(match[0]) - 1 : -1;

      if (pickedIdx >= 0 && pickedIdx < kps.length) {
        const picked = kps[pickedIdx];
        await supabase.from("material_knowledge_points").upsert({
          material_id: r.material_id, kp_id: picked.id,
          chunk_id: (r as any).chunk_id || null, source: "ai_review"
        }, { onConflict: "material_id,kp_id" });
        queryClient.refetchQueries({ queryKey: ["materials"] });
        setResults(prev => prev.filter(item => !(item.material_id === r.material_id && item.kp_id === r.kp_id)));
        setProgress("✅ AI 匹配: " + picked.name + " (原始回复: " + rawAnswer + ")");
      } else {
        setResults(prev => prev.filter(item => !(item.material_id === r.material_id && item.kp_id === r.kp_id)));
        setProgress("⚠ AI 判断不匹配 (回复: " + rawAnswer + ")，已跳过");
      }
    } catch (e) { setProgress("❌ AI 审核失败: " + (e instanceof Error ? e.message : "")); }
    setMatching(false);
    setTimeout(() => setProgress(""), 8000);
  };
  const aiReviewSingle = async () => {
    if (results.length === 0) return;
    await aiReviewOne(results[0]);
  };

  const aiReviewAll = async () => {
    if (results.length === 0) return;
    setMatching(true);
    const total = results.length;
    const DELAY_MS = 2000;
    for (let i = 0; i < total; i++) {
      setProgress("🤖 AI 审核中 (" + (i + 1) + "/" + total + ")...");
      await aiReviewOne(results[i]);
      if (i < total - 1) await new Promise(r => setTimeout(r, DELAY_MS));
    }
    setMatching(false);
    setProgress("✅ AI 审核完成: " + total + " 条已处理");
    setTimeout(() => setProgress(""), 5000);
  };


  const linkAll = async (threshold = 0.6) => {
    const toLink = results.filter((r) => r.match_score >= threshold);
    if (toLink.length === 0) { setProgress("没有 " + Math.round(threshold*100) + "% 以上的匹配"); return; }
    setProgress("正在自动关联 " + toLink.length + " 条...");
    for (const r of toLink) {
      await supabase.from("material_knowledge_points").upsert({ material_id: r.material_id, kp_id: r.kp_id, chunk_id: (r as any).chunk_id || null, source: "ai_review" }, { onConflict: "material_id,kp_id" });
    }
    setResults((prev) => prev.filter((r) => r.match_score < threshold));
    queryClient.invalidateQueries({ queryKey: ["materials"] });
    setProgress("已自动关联 " + toLink.length + " 条");
    setTimeout(() => setProgress(""), 3000);
  };


  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-amber-500" />
        AI 智能匹配
      </h3>
      <p className="text-xs text-gray-400">
        文档类资料自动下载PDF并提取正文, 逐段分块向量化后匹配知识点。需部署 parse-document 和 generate-embedding Edge Function。
      </p>
      {/* Subject filter for AI review */}
      {subjects && subjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400">限定科目:</span>
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubjectFilter(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])}
              className={"px-2 py-0.5 rounded text-xs transition-colors " + (subjectFilter.includes(s.id) ? "bg-indigo-500 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200")}
            >
              {s.name}
            </button>
          ))}
          {subjectFilter.length > 0 && (
            <button onClick={() => setSubjectFilter([])} className="text-xs text-gray-400 hover:text-gray-600 ml-1">
              清除
            </button>
          )}
        </div>
      )}


      {/* Progress feedback */}
      {progress && (
        <div className={"text-xs px-3 py-2 rounded-lg " + (
          progress.startsWith("✅") ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700" :
          progress.startsWith("❌") ? "bg-red-50 dark:bg-red-950/30 text-red-700" :
          "bg-amber-50 dark:bg-amber-950/30 text-amber-700"
        )}>
          {matching && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5 align-middle" />}
          {progress}
        </div>
      )}

      {/* Unlinked materials */}
      {unlinked.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="text-xs text-gray-500">{unlinked.length} 份资料待解析:</p><button onClick={() => batchVectorize("materials")} disabled={matching} className="text-xs text-amber-600 hover:text-amber-800 hover:underline disabled:opacity-30">⚡ 提交解析任务</button></div>
          <div className="flex flex-wrap gap-2">
            {unlinked.slice(0, 10).map((m) => (
              <button
                key={m.id}
                onClick={() => parseDocument(m.id)}
                disabled={matching}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                <Zap className="w-3 h-3" /> {m.title.slice(0, 20)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Unembedded knowledge points */}
      {unembeddedKpsList.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="text-xs text-gray-500">{unembeddedKpsList.length} 个知识点待向量化:</p><button onClick={() => batchVectorize("kps")} disabled={matching} className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline disabled:opacity-30">⚡ 全部向量化</button></div>
          <div className="flex flex-wrap gap-2">
            {unembeddedKpsList.slice(0, 10).map((kp) => (
              <button
                key={kp.id}
                onClick={() => generateKpEmbedding(kp.id)}
                disabled={matching}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                <Zap className="w-3 h-3" /> {kp.name.slice(0, 20)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Batch all */}
      {allMaterials.length > 0 && (
        <button onClick={async () => { await batchVectorize("materials"); await batchVectorize("kps"); }} disabled={matching}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-indigo-500 text-white rounded-lg text-sm font-medium hover:from-amber-600 hover:to-indigo-600 disabled:opacity-50 w-full justify-center mb-2">
          <Zap className="w-4 h-4" />
          {matching ? "处理中..." : "⚡ 一键全部处理 (" + ((allMaterials.length - linked.length) + unembeddedKpsList.length) + " 项)"}
        </button>
      )}


      {/* Run matching */}
      {linked.length > 0 && embeddedKpsList.length > 0 && (
        <button
          onClick={runMatching}
          disabled={matching}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
        >
          <Sparkles className={"w-4 h-4" + (matching ? " animate-pulse" : "")} />
          {matching ? "匹配中..." : "AI 自动匹配知识点"}
        </button>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2 mt-2 max-h-96 overflow-y-auto pr-1">
          <div className="flex items-center justify-between"><p className="text-xs text-gray-500">待AI审核: {results.length} 条 (匹配度&lt;70%)</p><div className="flex gap-1">{results.length > 1 && <button onClick={aiReviewAll} disabled={matching} className="px-2 py-0.5 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">🤖 一键AI审核 ({results.length}条)</button>}{results.length > 0 && <button onClick={aiReviewSingle} disabled={matching} className="px-2 py-0.5 rounded text-xs bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50">🤖 AI 逐条审核</button>}</div></div>
          {results.map((r, i) => (
            <div key={i} className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-sm space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 truncate max-w-[120px]">{r.material_title}</span>
                <span className="text-gray-300">→</span>
                <span className="font-medium text-green-700 dark:text-green-300 truncate">{r.kp_name}</span>
                <span className="ml-auto text-xs text-green-500 font-mono">{Math.round(r.match_score * 100)}%</span>
                <button
                  onClick={() => { linkKp(r.material_id, r.kp_id, (r as any).chunk_id); setResults(prev => prev.filter(item => !(item.material_id === r.material_id && item.kp_id === r.kp_id))); }}
                  className="px-2 py-0.5 rounded text-xs bg-green-500 text-white hover:bg-green-600 shrink-0"
                >
                  关联
                </button>
              </div>
              {r.chunk_content && (
                <p className="text-xs text-gray-400 italic pl-2 border-l-2 border-green-200 ml-2">
                  &ldquo;{r.chunk_content.slice(0, 80)}{r.chunk_content.length > 80 ? "..." : ""}&rdquo;
                </p>
              )}
              {alternatives[r.material_id + "_" + r.kp_id] && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-indigo-500 mb-1">备选知识点:</p>
                  <div className="flex flex-wrap gap-1">
                    {alternatives[r.material_id + "_" + r.kp_id].map((a, j) => (
                      <button key={j} onClick={() => { linkKp(a.material_id, a.kp_id, (a as any).chunk_id); const key = r.material_id + "_" + r.kp_id; setAlternatives(prev => { const n = {...prev}; delete n[key]; return n; }); }}
                        className="px-2 py-0.5 rounded text-xs bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 hover:bg-indigo-100 flex items-center gap-1">
                        {a.kp_name}
                        <span className="text-indigo-400 font-mono">{Math.round(a.match_score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );



// ============================================================
// 任务解析面板 — 提交 + 轮询
// ============================================================
function TaskParser() {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3456";

  // 从后端 API 拉取所有任务（持久化队列，刷新不丢失）
  const { data: allTasks, refetch: refetchTasks } = useQuery({
    queryKey: ["parse-tasks"],
    queryFn: async () => {
      const res = await fetch(backendUrl + "/api/tasks?limit=30");
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
      const res = await fetch(backendUrl + "/api/tasks", {
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

}

