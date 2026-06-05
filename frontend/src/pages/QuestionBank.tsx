import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { backendFetch } from "@/lib/backend";
import { QuestionBankItem, Subject, Plan, PlanPhase } from "@/types";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Search, Filter, ChevronDown, ChevronRight, Trash2, FileDown,
  ListPlus, BookOpen, CheckCircle2, X, Brain, Pencil,
  Star, Loader2,
} from "lucide-react";

// ---- Markdown preprocessor ----
function preprocessMarkdown(text: string): string {
  let result = text;
  // Ensure blank line before table blocks
  result = result.replace(/([^\n])\n(\|[^\n]+\|\n\|[:\- ]+\|)/g, "$1\n\n$2");
  // Fix alignment rows missing trailing pipe
  result = result.replace(/^(\|[ :\-]+\|[ :\-]+):$/gm, "$1|");
  return result;
}

const TYPE_LABELS: Record<string, string> = {
  choice: "选择题", short_answer: "简答题", calculation: "计算题",
  essay: "论述题", true_false: "判断题",
};

const TYPE_COLORS: Record<string, string> = {
  choice: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  short_answer: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  calculation: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  essay: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  true_false: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const SOURCE_LABELS: Record<string, string> = {
  ai_generated: "AI 生成", manual: "手动录入",
};

function safeOptions(opts: QuestionBankItem["options"]): { label: string; text: string }[] {
  if (!opts) return [];
  if (typeof opts === "string") {
    try { return JSON.parse(opts); } catch { return []; }
  }
  return opts as { label: string; text: string }[];
}

export default function QuestionBank({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState(0);
  const [filterSource, setFilterSource] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [planModal, setPlanModal] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [selectedPhase, setSelectedPhase] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: questions, isLoading } = useQuery({
    queryKey: ["question-bank", filterType, filterDifficulty, filterSource],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (filterDifficulty > 0) params.set("difficulty", String(filterDifficulty));
      if (filterSource) params.set("source", filterSource);
      params.set("limit", "200");

      const res = await backendFetch(`/api/questions?${params}`);
      if (res.status === 401) return [];
      const json = await res.json();
      return (json.questions || []) as QuestionBankItem[];
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data } = await supabase.from("plans").select("*, plan_phases(*)").order("created_at", { ascending: false });
      return data as (Plan & { plan_phases: PlanPhase[] })[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await backendFetch(`/api/questions/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["question-bank"] }),
  });

  const toPlanMutation = useMutation({
    mutationFn: async (questionId: string) => {
      const res = await backendFetch("/api/questions/to-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: questionId, plan_id: selectedPlan, phase_id: selectedPhase || undefined }),
      });
      return res.json();
    },
    onSuccess: () => {
      setPlanModal(null);
      setSelectedPlan("");
      setSelectedPhase("");
      queryClient.invalidateQueries({ queryKey: ["today-goal"] });
    },
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!filtered) return;
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((q) => q.id)));
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const ids = selected.size > 0 ? Array.from(selected) : (filtered || []).map((q) => q.id);
      const res = await backendFetch("/api/tasks/queue/pdf-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_ids: ids }),
      });
      if (res.ok) {
        alert("PDF 导出任务已提交，请在「任务队列」页面查看进度和下载。");
      } else {
        const json = await res.json().catch(() => ({}));
        alert("导出失败: " + (json.detail || res.status));
      }
    } finally {
      setExporting(false);
    }
  };

  const batchAddToPlan = () => {
    if (selected.size === 1) {
      setPlanModal(Array.from(selected)[0]);
    }
  };

  const filtered = questions?.filter((q) => {
    if (search && !q.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className={embedded ? "space-y-6" : "max-w-4xl mx-auto space-y-6"}>
      <div className="flex items-center justify-between">
        <h1 className={cn("font-bold flex items-center gap-2", embedded ? "text-lg" : "text-2xl")}>
          <Brain className={embedded ? "w-5 h-5 text-primary-600" : "w-6 h-6 text-primary-600"} />
          题库
        </h1>
      </div>

      {/* Filters + Batch Actions */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm"
            placeholder="搜索题目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm">
          <option value="">全部题型</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(Number(e.target.value))}
          className="px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm">
          <option value={0}>全部难度</option>
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{"★".repeat(d)}{"☆".repeat(5 - d)}</option>)}
        </select>

        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
          className="px-3 py-2 rounded-lg border bg-white dark:bg-gray-900 text-sm">
          <option value="">全部来源</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* Batch actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-gray-500">{selected.size} 选中</span>
            <button onClick={handleExportPdf} disabled={exporting}
              className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              导出 PDF
            </button>
            {selected.size === 1 && (
              <button onClick={batchAddToPlan}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 flex items-center gap-1">
                <ListPlus className="w-3.5 h-3.5" />加入计划
              </button>
            )}
            <button onClick={() => setSelected(new Set())}
              className="p-2 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
        )}

        {selected.size === 0 && filtered && filtered.length > 0 && (
          <button onClick={selectAll} className="ml-auto px-3 py-2 text-sm text-gray-500 hover:text-primary-600">
            {selected.size === filtered.length ? "取消全选" : "全选"}
          </button>
        )}
      </div>

      {/* Question list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : !filtered || filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>题库为空</p>
          <p className="text-xs mt-1">在 AI 学习中心生成题目后，点击「提取到题库」即可</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((q) => {
            const isExpanded = expanded.has(q.id);
            const isSelected = selected.has(q.id);
            return (
              <div key={q.id} className={cn(
                "bg-white dark:bg-gray-900 rounded-xl border overflow-hidden transition-colors",
                isSelected ? "border-primary-400 ring-1 ring-primary-200" : "border-gray-200 dark:border-gray-800"
              )}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(q.id)}
                      className="mt-1.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium", TYPE_COLORS[q.type] || "bg-gray-100")}>
                          {TYPE_LABELS[q.type] || q.type}
                        </span>
                        <span className="text-xs text-amber-500">{"★".repeat(q.difficulty)}{"☆".repeat(5 - q.difficulty)}</span>
                        <span className="text-xs text-gray-400">{SOURCE_LABELS[q.source] || q.source}</span>
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm cursor-pointer"
                        onClick={() => toggleExpand(q.id)}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {q.content.length > 120 && !isExpanded ? q.content.slice(0, 120) + "..." : q.content}
                        </ReactMarkdown>
                      </div>

                      {/* Options (for choice/true_false) */}
                      {isExpanded && safeOptions(q.options).length > 0 && (
                        <div className="mt-2 ml-4 space-y-0.5">
                          {safeOptions(q.options).map((opt, i) => (
                            <div key={i} className="text-sm text-gray-600 dark:text-gray-400">
                              <strong>{opt.label}.</strong> {opt.text}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Answer + Explanation (collapsed by default) */}
                      {isExpanded && (
                        <div className="mt-3 space-y-2">
                          {q.answer && (
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border-l-3 border-emerald-400 text-sm">
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">答案：</span>
                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                {q.answer}
                              </ReactMarkdown>
                            </div>
                          )}
                          {q.explanation && (
                            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border-l-3 border-amber-400 text-sm">
                              <span className="font-semibold text-amber-700 dark:text-amber-400">解析：</span>
                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                {q.explanation}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => toggleExpand(q.id)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <button onClick={() => setPlanModal(q.id)}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" title="加入计划">
                        <ListPlus className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteMutation.mutate(q.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Plan selection modal */}
      {planModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPlanModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4">添加到计划</h3>
            <div className="space-y-3">
              <select value={selectedPlan} onChange={(e) => { setSelectedPlan(e.target.value); setSelectedPhase(""); }}
                className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm">
                <option value="">选择计划...</option>
                {(plans || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {selectedPlan && (
                <select value={selectedPhase} onChange={(e) => setSelectedPhase(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm">
                  <option value="">自动选择阶段</option>
                  {(plans || []).find((p) => p.id === selectedPlan)?.plan_phases?.map((ph) => (
                    <option key={ph.id} value={ph.id}>{ph.name} ({ph.status})</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPlanModal(null)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">取消</button>
              <button onClick={() => toPlanMutation.mutate(planModal)} disabled={!selectedPlan}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50">
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
