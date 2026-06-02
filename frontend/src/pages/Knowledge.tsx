import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { KnowledgePoint, Subject } from "@/types";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Star,
  CheckCircle2,
  Circle,
  Search, FileJson,
} from "lucide-react";

export default function Knowledge() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSubject, setSelectedSubject] = useState<string>("all");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data } = await supabase.from("subjects").select("*").order("sort_order");
      return data as Subject[];
    },
  });

  const { data: points, isLoading } = useQuery({
    queryKey: ["knowledge-points", selectedSubject],
    queryFn: async () => {
      let query = supabase.from("knowledge_points").select("*").order("sort_order");
      if (selectedSubject !== "all") {
        query = query.eq("subject_id", selectedSubject);
      }
      const { data } = await query;
      return data as KnowledgePoint[];
    },
  });

  // Build tree
  const rootPoints = points?.filter((p) => !p.parent_id) ?? [];
  const childrenMap = new Map<string, KnowledgePoint[]>();
  points?.forEach((p) => {
    if (p.parent_id) {
      const list = childrenMap.get(p.parent_id) ?? [];
      list.push(p);
      childrenMap.set(p.parent_id, list);
    }
  });

  const toggleExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Stats
  const total = points?.length ?? 0;
  const mastered = points?.filter((p) => p.is_mastered).length ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">知识体系</h1>
        <button
          onClick={() => {
            setParentId(null);
            setShowForm(!showForm);
            setShowJsonImport(false);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
        >
          <Plus className="w-4 h-4" />
          添加知识点
        </button>
        <button
          onClick={() => {
            setShowJsonImport(!showJsonImport);
            setShowForm(false);
          }}
          className="flex items-center gap-2 px-4 py-2 border border-primary-300 text-primary-600 rounded-lg text-sm font-medium hover:bg-primary-50 dark:hover:bg-primary-950"
        >
          <FileJson className="w-4 h-4" />
          JSON 导入
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm">
        <div className="bg-white dark:bg-gray-900 rounded-lg border px-4 py-2">
          📚 总计 <span className="font-bold ml-1">{total}</span> 个知识点
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-lg border px-4 py-2">
          ✅ 已掌握 <span className="font-bold ml-1">{mastered}</span>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-lg border px-4 py-2">
          📊 掌握率{" "}
          <span className="font-bold ml-1">
            {total > 0 ? Math.round((mastered / total) * 100) : 0}%
          </span>
        </div>
      </div>

      {/* Subject filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedSubject("all")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            selectedSubject === "all"
              ? "bg-primary-600 text-white"
              : "bg-white dark:bg-gray-900 border text-gray-600 hover:bg-gray-50"
          )}
        >
          全部
        </button>
        {subjects?.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedSubject(s.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border",
              selectedSubject === s.id
                ? "text-white"
                : "bg-white dark:bg-gray-900 text-gray-600 hover:bg-gray-50"
            )}
            style={
              selectedSubject === s.id
                ? { backgroundColor: s.color, borderColor: s.color }
                : { borderColor: s.color + "40" }
            }
          >
            {s.name}
          </button>
        ))}
      </div>

            {/* JSON Import */}
      {showJsonImport && (
        <JsonImportPanel
          subjects={subjects ?? []}
          onClose={() => setShowJsonImport(false)}
          onImported={() => {
            setShowJsonImport(false);
            queryClient.invalidateQueries({ queryKey: ["knowledge-points"] });
            queryClient.invalidateQueries({ queryKey: ["knowledge-points-embed"] });
          }}
        />
      )}

      {/*{/* Form */}
      {showForm && (
        <PointForm
          subjects={subjects ?? []}
          parentId={parentId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["knowledge-points"] });
          }}
        />
      )}

      {/* Tree */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : rootPoints.length > 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border divide-y">
          {rootPoints.map((p) => (
            <TreeNode
              key={p.id}
              point={p}
              childrenMap={childrenMap}
              expandedNodes={expandedNodes}
              onToggle={toggleExpand}
              onAddChild={(id) => {
                setParentId(id);
                setShowForm(true);
              }}
              depth={0}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>还没有知识点，先选择科目后添加吧</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 树节点
// ============================================================
function TreeNode({
  point,
  childrenMap,
  expandedNodes,
  onToggle,
  onAddChild,
  depth,
}: {
  point: KnowledgePoint;
  childrenMap: Map<string, KnowledgePoint[]>;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
  onAddChild: (id: string) => void;
  depth: number;
}) {
  const queryClient = useQueryClient();
  const children = childrenMap.get(point.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedNodes.has(point.id);

  const masteryMutation = useMutation({
    mutationFn: async () => {
      await supabase
        .from("knowledge_points")
        .update({ is_mastered: !point.is_mastered, mastered_at: point.is_mastered ? null : new Date().toISOString() })
        .eq("id", point.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge-points"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => supabase.from("knowledge_points").delete().eq("id", point.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge-points"] }),
  });

  const stars = Array.from({ length: 5 }, (_, i) => i < point.importance);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group",
          depth > 0 && "ml-6"
        )}
      >
        {/* Expand toggle */}
        <button
          className="w-5 h-5 flex items-center justify-center"
          onClick={() => hasChildren && onToggle(point.id)}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )
          ) : (
            <span className="w-4" />
          )}
        </button>

        {/* Mastery */}
        <button onClick={() => masteryMutation.mutate()} className="flex-shrink-0">
          {point.is_mastered ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : (
            <Circle className="w-5 h-5 text-gray-300" />
          )}
        </button>

        {/* Name */}
        <span
          className={cn(
            "flex-1 text-sm",
            point.is_mastered && "line-through text-gray-400"
          )}
        >
          {point.name}
        </span>

        {/* Importance stars */}
        <div className="hidden sm:flex gap-0.5">
          {stars.map((filled, i) => (
            <Star
              key={i}
              className={cn(
                "w-3 h-3",
                filled ? "text-amber-400 fill-amber-400" : "text-gray-200"
              )}
            />
          ))}
        </div>

        {/* Difficulty */}
        <span className="text-xs text-gray-400 w-16 text-right">
          {point.difficulty === 1 ? "⭐" : point.difficulty === 2 ? "⭐⭐" : point.difficulty === 3 ? "⭐⭐⭐" : point.difficulty === 4 ? "⭐⭐⭐⭐" : "⭐⭐⭐⭐⭐"}
        </span>

        {/* Actions */}
        <div className="hidden group-hover:flex items-center gap-1">
          <button
            onClick={() => onAddChild(point.id)}
            className="p-1 text-gray-400 hover:text-primary-500"
            title="添加子知识点"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="p-1 text-gray-400 hover:text-red-500"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Children */}
      {isExpanded &&
        children.map((child) => (
          <TreeNode
            key={child.id}
            point={child}
            childrenMap={childrenMap}
            expandedNodes={expandedNodes}
            onToggle={onToggle}
            onAddChild={onAddChild}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

// ============================================================
// 添加知识点表单
// ============================================================
function PointForm({
  subjects,
  parentId,
  onClose,
  onSaved,
}: {
  subjects: Subject[];
  parentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: "",
    description: "",
    subject_id: subjects[0]?.id ?? "",
    difficulty: 3,
    importance: 3,
  });

  const mutation = useMutation({
    mutationFn: async (f: typeof form) => {
      const { error } = await supabase.from("knowledge_points").insert({
        user_id: user?.id,
        ...f,
        parent_id: parentId,
      });
      if (error) throw error;
    },
    onSuccess: onSaved,
  });

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-4">
      <h3 className="font-medium text-sm text-gray-500">
        {parentId ? "添加子知识点" : "添加根知识点"}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <input
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            placeholder="知识点名称 *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">所属科目</label>
          <select
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            value={form.subject_id}
            onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">难度 (1-5)</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                className={`px-2 py-1 rounded text-xs ${
                  form.difficulty >= d
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-400"
                }`}
                onClick={() => setForm({ ...form, difficulty: d })}
              >
                ⭐
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">考试重要性 (1-5)</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                className={`px-2 py-1 rounded text-xs ${
                  form.importance >= d
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-400"
                }`}
                onClick={() => setForm({ ...form, importance: d })}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <textarea
            className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
            rows={2}
            placeholder="描述 (可选)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">取消</button>
        <button
          disabled={!form.name || !form.subject_id}
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
// JSON 导入面板
// ============================================================
interface JsonKpItem {
  name: string;
  description?: string;
  difficulty?: number;
  importance?: number;
  children?: JsonKpItem[];
}

function JsonImportPanel({
  subjects,
  onClose,
  onImported,
}: {
  subjects: Subject[];
  onClose: () => void;
  onImported: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [jsonText, setJsonText] = useState("");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<string[]>([]);

  // Auto-detect format: array [{name, children}] vs dict {考试科目, 知识点提炼:{...}}
  const parsePreview = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      const names: string[] = [];
      if (Array.isArray(parsed)) {
        // Format A: [{name, children}, ...]
        const walk = (list: JsonKpItem[], indent: number) => {
          for (const item of list) {
            names.push("  ".repeat(indent) + (item.children?.length ? "📁 " : "📄 ") + item.name);
            if (item.children?.length) walk(item.children, indent + 1);
          }
        };
        walk(parsed, 0);
      } else if (parsed["知识点提炼"]) {
        // Format B: {考试科目, 知识点提炼: {科目: {章: [...]}}}
        const kp = parsed["知识点提炼"];
        for (const subjectName of Object.keys(kp)) {
          names.push("📘 科目: " + subjectName);
          for (const chapter of Object.keys(kp[subjectName])) {
            const items = kp[subjectName][chapter];
            names.push("  📁 " + chapter + " (" + (Array.isArray(items) ? items.length : 0) + ")");
            if (Array.isArray(items)) {
              for (const item of items.slice(0, 3)) {
                names.push("    📄 " + item);
              }
              if (items.length > 3) names.push("    ... 等 " + items.length + " 个");
            }
          }
        }
      } else {
        names.push("⚠ 无法识别的 JSON 格式");
      }
      setPreview(names);
      setMsg("");
    } catch {
      setPreview([]);
      setMsg("JSON 格式错误");
    }
  };

  const doImport = async () => {
    if (!user?.id || !subjectId) return;
    setImporting(true); setMsg("");
    try {
      const parsed = JSON.parse(jsonText);
      let count = 0;

      if (Array.isArray(parsed)) {
        // Format A: recursive [{name, children}]
        const insertRecursive = async (list: JsonKpItem[], parentId: string | null) => {
          for (const item of list) {
            const { error, data } = await supabase
              .from("knowledge_points")
              .insert({
                user_id: user.id,
                subject_id: subjectId,
                parent_id: parentId,
                name: item.name,
                description: item.description || null,
                difficulty: item.difficulty ?? 3,
                importance: item.importance ?? 3,
              })
              .select("id")
              .single();
            if (error) throw new Error(item.name + ": " + error.message);
            count++;
            if (item.children?.length && data) {
              await insertRecursive(item.children, data.id);
            }
          }
        };
        await insertRecursive(parsed, null);

      } else if (parsed["知识点提炼"]) {
        // Format B: nested dict {考试科目, 知识点提炼: {科目名: {章名: [知识点...]}}}
        const kp = parsed["知识点提炼"];
        const subjectColors = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4"];
        let colorIdx = subjects.length;

        // Subject lookup: match existing or auto-create
        const getSubjectId = async (name: string): Promise<string> => {
          for (const s of subjects) {
            if (s.name === name || s.name.includes(name) || name.includes(s.name)) {
              return s.id;
            }
          }
          // Auto-create
          const { data: created, error: ce } = await supabase
            .from("subjects")
            .insert({ user_id: user.id, name, color: subjectColors[colorIdx % subjectColors.length], sort_order: colorIdx })
            .select("id").single();
          if (ce) throw new Error("创建科目 " + name + " 失败: " + ce.message);
          subjects.push({ id: created.id, name, color: subjectColors[colorIdx % subjectColors.length], user_id: user.id, code: null, icon: null, sort_order: colorIdx, created_at: "" });
          colorIdx++;
          return created.id;
        };

        for (const subjectName of Object.keys(kp)) {
          const subSubjectId = await getSubjectId(subjectName);
          for (const chapter of Object.keys(kp[subjectName])) {
            const items = kp[subjectName][chapter];
            if (!Array.isArray(items)) continue;
            const { error: chErr, data: chData } = await supabase
              .from("knowledge_points")
              .insert({ user_id: user.id, subject_id: subSubjectId, parent_id: null, name: chapter, description: subjectName, difficulty: 3, importance: 4 })
              .select("id").single();
            if (chErr) throw new Error(chapter + ": " + chErr.message);
            count++;
            for (const itemName of items) {
              const { error: kpErr } = await supabase
                .from("knowledge_points")
                .insert({ user_id: user.id, subject_id: subSubjectId, parent_id: chData.id, name: itemName, difficulty: 3, importance: 3 });
              if (kpErr) throw new Error(itemName + ": " + kpErr.message);
              count++;
            }
          }
        }
        queryClient.invalidateQueries({ queryKey: ["subjects"] });
setMsg("❌ 无法识别的 JSON 格式"); setImporting(false); return;
      }

      setMsg("✅ 成功导入 " + count + " 个知识点");
      queryClient.invalidateQueries({ queryKey: ["knowledge-points"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-points-embed"] });
      onImported();
    } catch (e) {
      setMsg("❌ 导入失败: " + (e instanceof Error ? e.message : ""));
    }
    setImporting(false);
  };

  const sampleJsonA = [
    { name: "极限与连续", description: "函数的极限与连续性", difficulty: 4, importance: 5, children: [
      { name: "数列极限", difficulty: 3, importance: 4 },
      { name: "函数极限", difficulty: 4, importance: 5 },
    ]},
    { name: "导数与微分", description: "导数概念与求导法则", difficulty: 4, importance: 5 },
  ];

  const sampleJsonB = {
    "考试科目": "数学（一）",
    "知识点提炼": {
      "高等数学": {
        "函数、极限、连续": ["函数的概念", "数列极限", "函数极限", "无穷小量"],
        "一元函数微分学": ["导数的概念", "微分中值定理"],
      },
    },
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-gray-500">JSON 批量导入知识点</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-400">所属科目:</label>
        <select
          className="px-3 py-1.5 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">
          粘贴 JSON (支持两种格式):
        </label>
        <textarea
          className="w-full h-48 px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm font-mono"
          placeholder='格式A: [{ "name": "知识点", "children": [...] }]&#10;格式B: { "考试科目": "...", "知识点提炼": { "科目": { "章": ["知识点"] } } }'
          value={jsonText}
          onChange={(e) => { setJsonText(e.target.value); parsePreview(e.target.value); }}
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { const s = JSON.stringify(sampleJsonA, null, 2); setJsonText(s); parsePreview(s); }}
          className="text-xs text-primary-500 hover:underline"
        >
          📋 示例 A (数组格式)
        </button>
        <button
          onClick={() => { const s = JSON.stringify(sampleJsonB, null, 2); setJsonText(s); parsePreview(s); }}
          className="text-xs text-primary-500 hover:underline"
        >
          📋 示例 B (大纲格式)
        </button>
      </div>

      {preview.length > 0 && (
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs font-mono space-y-0.5 max-h-40 overflow-auto">
          <p className="text-gray-400 mb-1">预览 ({preview.length} 行):</p>
          {preview.map((line, i) => (
            <div key={i} className="text-gray-600 dark:text-gray-300">{line}</div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={doImport}
          disabled={!jsonText.trim() || importing}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {importing ? "导入中..." : "导入"}
        </button>
        {msg && (
          <span className={"text-sm " + (msg.startsWith("✅") ? "text-emerald-600" : "text-red-500")}>
            {msg}
          </span>
        )}
      </div>

      <details className="text-xs text-gray-400">
        <summary className="cursor-pointer">支持两种 JSON 格式</summary>
        <div className="mt-2 p-2 rounded bg-gray-50 dark:bg-gray-800 space-y-2">
          <div>
            <p className="font-medium text-gray-500">格式 A (数组):</p>
            <code>{"[{ \"name\":\"知识点\", \"children\":[...], \"difficulty\":3, \"importance\":3 }]"}</code>
          </div>
          <div>
            <p className="font-medium text-gray-500">格式 B (大纲):</p>
            <code>{"{ \"考试科目\":\"数学（一）\", \"知识点提炼\":{ \"科目名\":{ \"章名\":[\"知识点1\",\"知识点2\"] } } }"}</code>
          </div>
        </div>
      </details>
    </div>
  );
}
