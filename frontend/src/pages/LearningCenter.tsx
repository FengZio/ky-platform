import { memo, useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { backendFetch } from "@/lib/backend";
import { KnowledgePoint, Subject, LearningMaterial, QuestionBankItem } from "@/types";
import { cn } from "@/lib/utils";
import { katexOptions, normalizeMarkdownMath } from "@/lib/markdown";
import { useLearningWs, type ChatMessage, type ContextItem } from "@/contexts/LearningWsContext";
import {
  EmptyStatePanel,
  PrimaryButton,
  SearchInput,
  StatusChip,
  WorkbenchCard,
} from "@/components/workbench";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Brain,
  Send,
  Bot,
  User,
  Loader2,
  BookOpen,
  Lightbulb,
  RefreshCw,
  Zap,
  Wifi,
  WifiOff,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Video,
  FileQuestion,
  StickyNote,
  X,
  FolderOpen,
  History,
  Plus,
  FileDown,
  CheckCircle2,
  Database,
} from "lucide-react";

interface TaskCacheItem {
  id: string;
  task_type: "pdf_export" | "doc_parse";
  status: "queued" | "processing" | "done" | "failed";
  progress_pct: number;
  message: string | null;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function cacheQueuedPdfTask(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
  questionIds: string[],
) {
  const now = new Date().toISOString();
  const queuedTask: TaskCacheItem = {
    id: taskId,
    task_type: "pdf_export",
    status: "queued",
    progress_pct: 0,
    message: "PDF 导出任务已提交",
    payload_json: { question_ids: questionIds },
    result_json: {},
    created_at: now,
    updated_at: now,
  };

  queryClient.setQueryData<TaskCacheItem[]>(["task-queue"], (current = []) => [
    queuedTask,
    ...current.filter((task) => task.id !== taskId),
  ]);
}

const markdownComponents = {
  h1: ({ children }: any) => <h1 className="mb-1 mt-2 text-lg font-bold">{children}</h1>,
  h2: ({ children }: any) => <h2 className="mb-1 mt-2 text-base font-bold">{children}</h2>,
  h3: ({ children }: any) => <h3 className="mb-0.5 mt-1.5 text-sm font-semibold">{children}</h3>,
  ul: ({ children }: any) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }: any) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }: any) => <li className="text-sm">{children}</li>,
  p: ({ children }: any) => <p className="my-1">{children}</p>,
  strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
  code: ({ children, className }: any) =>
    className ? (
      <code className="my-1 block overflow-x-auto rounded bg-surface-low px-2 py-1 text-xs">{children}</code>
    ) : (
      <code className="rounded bg-surface-low px-1 text-xs">{children}</code>
    ),
  pre: ({ children }: any) => <pre className="my-1 overflow-x-auto rounded-lg bg-surface-low p-2 text-xs">{children}</pre>,
  a: ({ children, href }: any) => (
    <a href={href} className="text-primary underline" target="_blank" rel="noopener">
      {children}
    </a>
  ),
  blockquote: ({ children }: any) => <blockquote className="my-1 border-l-[3px] border-outline-variant pl-3 italic text-foreground-muted">{children}</blockquote>,
  table: ({ children }: any) => <div className="my-2 overflow-x-auto"><table className="min-w-full border-collapse border border-outline-variant text-xs">{children}</table></div>,
  thead: ({ children }: any) => <thead className="bg-surface-low">{children}</thead>,
  tbody: ({ children }: any) => <tbody className="divide-y divide-outline-variant/70">{children}</tbody>,
  tr: ({ children }: any) => <tr className="border-b border-outline-variant/70">{children}</tr>,
  th: ({ children }: any) => <th className="min-w-[80px] border border-outline-variant px-3 py-1.5 text-left font-semibold text-foreground">{children}</th>,
  td: ({ children }: any) => <td className="min-w-[80px] border border-outline-variant px-3 py-1.5">{children}</td>,
  hr: () => <hr className="my-2 border-outline-variant" />,
};

const MemoMarkdown = memo(function MemoMarkdown({ content }: { content: string }) {
  const normalized = useMemo(() => normalizeMarkdownMath(content), [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[[rehypeKatex, katexOptions]]}
      components={markdownComponents}
    >
      {normalized}
    </ReactMarkdown>
  );
});

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseChineseSectionOrder(name: string): number | null {
  const match = name.trim().match(/^([一二三四五六七八九十]{1,3})[、.．，,]/);
  if (!match) return null;
  const raw = match[1];
  if (raw === "十") return 10;
  if (raw.startsWith("十")) return 10 + (CHINESE_NUMBERS[raw[1]] || 0);
  if (raw.endsWith("十")) return (CHINESE_NUMBERS[raw[0]] || 1) * 10;
  if (raw.includes("十")) return (CHINESE_NUMBERS[raw[0]] || 0) * 10 + (CHINESE_NUMBERS[raw[2]] || 0);
  return CHINESE_NUMBERS[raw] || null;
}

function sortKnowledgePoints(points: KnowledgePoint[]) {
  return [...points].sort((a, b) => {
    const sectionA = parseChineseSectionOrder(a.name);
    const sectionB = parseChineseSectionOrder(b.name);
    if (sectionA !== null || sectionB !== null) {
      return (sectionA ?? Number.MAX_SAFE_INTEGER) - (sectionB ?? Number.MAX_SAFE_INTEGER);
    }
    return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-primary/10 bg-primary/5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 bg-primary/5 px-3 py-2 text-xs text-primary/80 hover:bg-primary/10"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" />
        <span>思考过程{isStreaming ? "..." : ""}</span>
      </button>
      {open && (
        <div className="max-h-40 overflow-y-auto px-3 py-3 text-xs italic leading-relaxed text-foreground-muted whitespace-pre-wrap">
          {text}
          {isStreaming ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary/40 align-middle" /> : null}
        </div>
      )}
    </div>
  );
}

export default function LearningCenter() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const {
    messages,
    input,
    agentConnected,
    turnActive,
    pairingCode,
    conversationId,
    selectedKps,
    selectedMaterials,
    setInput,
    setConversationId,
    setMessages,
    toggleKp,
    toggleMaterial,
    removeContext,
    handleSend,
    handleQuickAsk,
    newConversation,
  } = useLearningWs();

  const [searchText, setSearchText] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [extractModal, setExtractModal] = useState<{ questions: any[] } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"knowledge" | "materials">("knowledge");
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [expandedKnowledgeNodes, setExpandedKnowledgeNodes] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data } = await supabase.from("subjects").select("*").order("sort_order");
      return data as Subject[];
    },
  });

  const { data: points } = useQuery({
    queryKey: ["knowledge-points"],
    queryFn: async () => {
      const { data } = await supabase
        .from("knowledge_points")
        .select("id,subject_id,parent_id,material_id,name,description,difficulty,importance,sort_order,is_mastered,mastered_at,created_at,updated_at")
        .order("sort_order");
      return data as KnowledgePoint[];
    },
  });

  const { data: materials } = useQuery({
    queryKey: ["learning-materials"],
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_materials")
        .select("id,title,type,subject_id,knowledge_point_id")
        .order("created_at", { ascending: false })
        .limit(100);
      return data as (LearningMaterial & { subject_id?: string; knowledge_point_id?: string })[];
    },
  });

  const { data: conversations } = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_conversations")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(20);
      return data;
    },
  });

  const pointsBySubject = useMemo(() => {
    return (points || []).reduce((acc, kp) => {
      const sid = kp.subject_id;
      if (!acc[sid]) acc[sid] = [];
      acc[sid].push(kp);
      return acc;
    }, {} as Record<string, KnowledgePoint[]>);
  }, [points]);

  const childrenByParent = useMemo(() => {
    const grouped = (points || []).reduce((acc, kp) => {
      if (!kp.parent_id) return acc;
      if (!acc[kp.parent_id]) acc[kp.parent_id] = [];
      acc[kp.parent_id].push(kp);
      return acc;
    }, {} as Record<string, KnowledgePoint[]>);

    Object.keys(grouped).forEach((parentId) => {
      grouped[parentId] = sortKnowledgePoints(grouped[parentId]);
    });

    return grouped;
  }, [points]);

  const selectedKpIds = useMemo(() => new Set(selectedKps.map((kp) => kp.id)), [selectedKps]);
  const selectedMaterialIds = useMemo(() => new Set(selectedMaterials.map((material) => material.id)), [selectedMaterials]);

  const filteredMaterials = useMemo(
    () => materials?.filter((m) => !materialSearch || m.title.includes(materialSearch)) ?? [],
    [materials, materialSearch],
  );

  const materialsBySubject = useMemo(() => {
    return filteredMaterials.reduce((acc, material) => {
      if (!material.subject_id) return acc;
      if (!acc[material.subject_id]) acc[material.subject_id] = [];
      acc[material.subject_id].push(material);
      return acc;
    }, {} as Record<string, (LearningMaterial & { subject_id?: string; knowledge_point_id?: string })[]>);
  }, [filteredMaterials]);

  const unassignedMaterials = useMemo(() => filteredMaterials.filter((m) => !m.subject_id), [filteredMaterials]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleSubject = (sid: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  };

  const toggleKnowledgeNode = (id: string) => {
    setExpandedKnowledgeNodes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const knowledgeMatchesSearch = (kp: KnowledgePoint) =>
    !searchText || kp.name.includes(searchText) || kp.description?.includes(searchText);

  const knowledgeTreeMatchesSearch = (kp: KnowledgePoint): boolean => {
    if (knowledgeMatchesSearch(kp)) return true;
    return (childrenByParent[kp.id] || []).some((child) => knowledgeTreeMatchesSearch(child));
  };

  const renderKnowledgeNode = (kp: KnowledgePoint, depth: number) => {
    const children = childrenByParent[kp.id] || [];
    const visibleChildren = searchText ? children.filter((child) => knowledgeTreeMatchesSearch(child)) : children;
    const selected = selectedKpIds.has(kp.id);
    const hasChildren = visibleChildren.length > 0;
    const expanded = searchText ? true : expandedKnowledgeNodes.has(kp.id);
    const isMajorPoint = depth === 0;

    return (
      <div key={kp.id} className={cn(isMajorPoint ? "mt-2 first:mt-0" : "mt-1")}>
        <div
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-md text-left text-xs transition-colors hover:bg-surface-low",
            isMajorPoint ? "bg-white px-2.5 py-2 shadow-workbench" : "px-2 py-1.5",
            selected ? "bg-primary/8 text-primary" : "",
          )}
          style={{ paddingLeft: isMajorPoint ? undefined : `${8 + depth * 12}px` }}
        >
          <button
            type="button"
            onClick={() => (hasChildren ? toggleKnowledgeNode(kp.id) : toggleKp(kp))}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-surface-base"
          >
            {hasChildren ? (
              expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-outline" />
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleKp(kp)}
            className={cn(
              "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border",
              selected ? "border-primary bg-primary" : "border-outline-variant",
            )}
          >
            {selected ? <Check className="h-2.5 w-2.5 text-white" /> : null}
          </button>
          <button type="button" onClick={() => toggleKp(kp)} className="min-w-0 flex-1 text-left">
            <span className={cn("block truncate", isMajorPoint ? "font-medium text-foreground" : "")}>{kp.name}</span>
            {isMajorPoint && kp.description ? (
              <span className="mt-0.5 block truncate text-[11px] font-normal text-foreground-muted">{kp.description}</span>
            ) : null}
          </button>
          {hasChildren ? <span className="text-[11px] text-foreground-muted">{visibleChildren.length}</span> : null}
        </div>
        {hasChildren && expanded ? (
          <div className={cn(isMajorPoint ? "ml-5 border-l border-outline-variant/70 pl-2" : "")}>
            {visibleChildren.map((child) => renderKnowledgeNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const loadConversation = async (convId: string) => {
    setConversationId(convId);
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      setMessages(
        data.map((m: { role: string; content: string }) => ({
          role: m.role as ChatMessage["role"],
          content: m.content,
        })),
      );
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(pairingCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const materialIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-3 w-3" />;
      case "exercise":
        return <FileQuestion className="h-3 w-3" />;
      case "note":
        return <StickyNote className="h-3 w-3" />;
      default:
        return <FileText className="h-3 w-3" />;
    }
  };

  const handleGenerateQuestion = () => {
    const allNames = [...selectedKps.map((k) => k.name), ...selectedMaterials.map((m) => m.name)];
    const topic = allNames.length > 0 ? allNames.join("、") : "当前知识点";
    handleQuickAsk(`请根据「${topic}」出2道考研难度的题目，包含选择题和计算题，并给出详细解析。`);
  };

  const handleAnalogy = () => {
    const allNames = [...selectedKps.map((k) => k.name), ...selectedMaterials.map((m) => m.name)];
    const topic = allNames.length > 0 ? allNames.join("、") : "当前知识点";
    handleQuickAsk(`请围绕「${topic}」举一反三，给出2道变体题目，考察相同的核心概念但变换题型或角度。`);
  };

  const handleExtractToBank = async () => {
    setExtracting(true);
    try {
      const lastAssistant = [...messages].reverse().find((m: ChatMessage) => m.role === "assistant");
      if (!lastAssistant) return;
      const res = await backendFetch("/api/resources/questions/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: lastAssistant.content,
          conversation_id: conversationId || undefined,
          knowledge_point_ids: selectedKps.map((k: ContextItem) => k.id),
        }),
      });
      const data = await res.json();
      const extractedQuestions = (data.questions || []) as QuestionBankItem[];
      if (extractedQuestions.length > 0) {
        queryClient.setQueriesData<QuestionBankItem[]>({ queryKey: ["question-bank"] }, (current = []) => {
          const existingIds = new Set(current.map((question) => question.id));
          return [
            ...extractedQuestions.filter((question) => question.id && !existingIds.has(question.id)),
            ...current,
          ];
        });
      }
      setExtractModal({ questions: extractedQuestions });
    } catch (e) {
      console.error("Extract failed:", e);
    } finally {
      setExtracting(false);
    }
  };

  const handleExportToQueue = async () => {
    try {
      const lastAssistant = [...messages].reverse().find((m: ChatMessage) => m.role === "assistant");
      if (!lastAssistant) return;
      const extractRes = await backendFetch("/api/resources/questions/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: lastAssistant.content,
          conversation_id: conversationId || undefined,
          knowledge_point_ids: selectedKps.map((k: ContextItem) => k.id),
        }),
      });
      const extractData = await extractRes.json();
      const ids = (extractData.questions || []).map((q: any) => q.id);
      if (ids.length === 0) {
        alert("未检测到可导出的题目");
        return;
      }
      const taskRes = await backendFetch("/api/resources/tasks/pdf-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_ids: ids }),
      });
      if (!taskRes.ok) {
        const json = await taskRes.json().catch(() => ({}));
        alert("导出失败: " + (json.detail || taskRes.status));
        return;
      }
      const taskData = await taskRes.json();
      if (taskData.task_id) {
        cacheQueuedPdfTask(queryClient, taskData.task_id, ids);
      }
      queryClient.invalidateQueries({ queryKey: ["task-queue"] });
      navigate("/resources?tab=tasks");
    } catch (e) {
      console.error("Export queue failed:", e);
    }
  };

  return (
    <>
      <div className="grid h-[calc(100vh-116px)] min-h-0 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <WorkbenchCard className="flex h-full min-h-0 flex-col overflow-hidden p-0">
          <div className="border-b border-outline-variant/70 px-4 py-4">
            <div className="flex rounded-full bg-surface-low p-1">
              <button
                onClick={() => setSidebarTab("knowledge")}
                className={cn(
                  "flex-1 rounded-full px-3 py-2 text-xs font-medium transition-colors",
                  sidebarTab === "knowledge" ? "bg-white text-primary shadow-workbench" : "text-foreground-muted hover:text-foreground",
                )}
              >
                <BookOpen className="mr-1 inline h-3.5 w-3.5" />
                知识点
              </button>
              <button
                onClick={() => setSidebarTab("materials")}
                className={cn(
                  "flex-1 rounded-full px-3 py-2 text-xs font-medium transition-colors",
                  sidebarTab === "materials" ? "bg-white text-primary shadow-workbench" : "text-foreground-muted hover:text-foreground",
                )}
              >
                <FolderOpen className="mr-1 inline h-3.5 w-3.5" />
                学习资料
              </button>
            </div>
            <SearchInput
              className="mt-4 h-10 text-xs"
              placeholder={sidebarTab === "knowledge" ? "搜索知识点..." : "搜索学习资料..."}
              value={sidebarTab === "knowledge" ? searchText : materialSearch}
              onChange={(e) => (sidebarTab === "knowledge" ? setSearchText(e.target.value) : setMaterialSearch(e.target.value))}
            />
          </div>

          <div className="flex-1 overflow-auto px-3 py-3">
            {sidebarTab === "knowledge" ? (
              <div className="space-y-2">
                {subjects?.map((subject) => {
                  const subjectPoints = pointsBySubject[subject.id] || [];
                  const subjectPointIds = new Set(subjectPoints.map((p) => p.id));
                  const rootPoints = sortKnowledgePoints(subjectPoints.filter((p) => !p.parent_id || !subjectPointIds.has(p.parent_id)));
                  const visibleRootPoints = searchText ? rootPoints.filter((p) => knowledgeTreeMatchesSearch(p)) : rootPoints;
                  if (visibleRootPoints.length === 0) return null;
                  const expanded = expandedSubjects.has(subject.id);
                  return (
                    <div key={subject.id} className="overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-lowest">
                      <button
                        onClick={() => toggleSubject(subject.id)}
                        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-foreground hover:bg-surface-low"
                      >
                        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: subject.color || "#6366f1" }} />
                        {subject.name}
                        <span className="ml-auto text-foreground-muted">{subjectPoints.length}</span>
                      </button>
                      {expanded ? (
                        <div className="mx-3 mb-3">
                          {visibleRootPoints.slice(0, 50).map((kp) => renderKnowledgeNode(kp, 0))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {subjects?.map((subject) => {
                  const subjectMaterials = materialsBySubject[subject.id] || [];
                  if (subjectMaterials.length === 0) return null;
                  const expanded = expandedSubjects.has(subject.id);
                  return (
                    <div key={subject.id} className="overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-lowest">
                      <button
                        onClick={() => toggleSubject(subject.id)}
                        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-foreground hover:bg-surface-low"
                      >
                        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: subject.color || "#6366f1" }} />
                        {subject.name}
                        <span className="ml-auto text-foreground-muted">{subjectMaterials.length}</span>
                      </button>
                      {expanded ? (
                        <div className="mx-3 mb-3 border-l border-outline-variant/70 pl-3">
                          {subjectMaterials.slice(0, 50).map((m) => {
                            const selected = selectedMaterialIds.has(m.id);
                            return (
                              <button
                                key={m.id}
                                onClick={() => toggleMaterial(m)}
                                className={cn(
                                  "mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-xs hover:bg-surface-low",
                                  selected ? "bg-primary/8 text-primary" : "",
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border",
                                    selected ? "border-primary bg-primary" : "border-outline-variant",
                                  )}
                                >
                                  {selected ? <Check className="h-2.5 w-2.5 text-white" /> : null}
                                </span>
                                {materialIcon(m.type)}
                                <span className="truncate">{m.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {unassignedMaterials.length > 0 ? (
                  <div className="mt-2 border-t border-outline-variant/70 pt-2">
                    <div className="px-2 py-1 text-xs font-medium text-warning-700">未关联科目 {unassignedMaterials.length}</div>
                    {unassignedMaterials.slice(0, 20).map((m) => (
                      <div
                        key={m.id}
                        className="flex w-full cursor-not-allowed items-center gap-1.5 rounded px-2 py-1.5 text-xs text-foreground-muted"
                        title="请先在学习资料页面手动关联学科"
                      >
                        <span className="h-3.5 w-3.5 rounded border border-outline-variant flex-shrink-0" />
                        {materialIcon(m.type)}
                        <span className="truncate">{m.title}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </WorkbenchCard>

        <WorkbenchCard className="flex h-full min-h-0 flex-col overflow-hidden p-0">
          <div className="border-b border-outline-variant/70 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <span className="text-base font-semibold">学习中心</span>
                <StatusChip tone={agentConnected ? "success" : pairingCode ? "warning" : "neutral"}>
                  {agentConnected ? (
                    <>
                      <Wifi className="h-3 w-3" />
                      Codex Agent 已连接
                    </>
                  ) : pairingCode ? (
                    <>
                      <WifiOff className="h-3 w-3" />
                      未连接
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      连接中...
                    </>
                  )}
                </StatusChip>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {pairingCode ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-secondary/20 px-3 py-1.5 text-xs text-warning-700">
                    <span className="font-mono tracking-wider">{pairingCode}</span>
                    <button onClick={copyCode} className="rounded p-0.5 hover:bg-secondary/30">
                      {codeCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                ) : null}
                <PrimaryButton onClick={newConversation} className="h-9 px-3 text-xs">
                  <Plus className="h-3 w-3" />
                  新对话
                </PrimaryButton>
              </div>
            </div>
          </div>

          {conversations && conversations.length > 0 ? (
            <div className="flex items-center gap-2 overflow-x-auto border-b border-outline-variant/70 bg-surface-low px-5 py-3">
              <History className="h-3.5 w-3.5 flex-shrink-0 text-foreground-muted" />
              {conversations.map((conv: { id: string; title: string }) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={cn(
                    "flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs",
                    conversationId === conv.id ? "bg-primary text-white shadow-workbench" : "bg-white text-foreground-muted hover:bg-surface-base",
                  )}
                >
                  {conv.title || "无标题"}
                </button>
              ))}
            </div>
          ) : null}

          {selectedKps.length > 0 || selectedMaterials.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/70 bg-primary/5 px-5 py-3">
              <Lightbulb className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <span className="text-xs text-primary">已选上下文:</span>
              {selectedKps.map((kp) => (
                <span key={kp.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-primary shadow-workbench">
                  <BookOpen className="h-3 w-3" />
                  {kp.name}
                  <button onClick={() => removeContext(kp)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {selectedMaterials.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-primary shadow-workbench">
                  <FileText className="h-3 w-3" />
                  {m.name}
                  <button onClick={() => removeContext(m)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto bg-surface-low px-5 py-5">
            {messages.length === 0 ? (
              <EmptyStatePanel
                icon={<Brain className="h-5 w-5" />}
                title="开始一段学习对话"
                description="选择左侧上下文后，可以直接让 AI 讲解、出题、举一反三，或整理为题库。"
              />
            ) : null}

            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex gap-2 text-sm", msg.role === "user" && "justify-end", msg.role === "system" && "justify-center")}>
                  {msg.role === "assistant" ? (
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-4 py-3 leading-relaxed shadow-workbench",
                      msg.role === "user"
                        ? "rounded-br-md bg-primary text-white"
                        : msg.role === "assistant"
                          ? "rounded-bl-md border border-outline-variant/60 bg-white prose prose-sm max-w-none"
                          : "max-w-[90%] bg-info/10 text-primary text-xs",
                    )}
                  >
                    {msg.role === "assistant" && msg.reasoning ? (
                      <ReasoningBlock text={msg.reasoning} isStreaming={!!msg.isStreaming && !msg.content} />
                    ) : null}

                    {msg.role === "assistant" ? (
                      <MemoMarkdown content={msg.content} />
                    ) : (
                      <span className="whitespace-pre-wrap">{normalizeMarkdownMath(msg.content)}</span>
                    )}

                    {msg.isStreaming ? <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-foreground-muted/40 align-middle" /> : null}

                    {msg.role === "assistant" && !msg.isStreaming && !turnActive ? (
                      <div className="mt-3 flex items-center gap-1.5 border-t border-outline-variant/70 pt-3">
                        <button
                          onClick={handleExtractToBank}
                          disabled={extracting}
                          className="flex items-center gap-1 rounded-md bg-primary/8 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/12 disabled:opacity-50"
                        >
                          {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                          提取到题库
                        </button>
                        <button
                          onClick={handleExportToQueue}
                          className="flex items-center gap-1 rounded-md bg-secondary/20 px-2.5 py-1.5 text-xs text-warning-700 transition-colors hover:bg-secondary/30"
                        >
                          <FileDown className="h-3 w-3" />
                          导出 PDF
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {msg.role === "user" ? (
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-high">
                      <User className="h-4 w-4 text-foreground-muted" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-outline-variant/70 bg-white p-4">
            <div className="rounded-[20px] border border-outline-variant/80 bg-surface-lowest p-3 shadow-workbench">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone="neutral">上下文 {selectedKps.length + selectedMaterials.length} 项</StatusChip>
                  <StatusChip tone={agentConnected ? "success" : "warning"}>{agentConnected ? "模型就绪" : "等待连接"}</StatusChip>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={handleGenerateQuestion}
                    disabled={!agentConnected || turnActive}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/15 bg-white px-3 text-xs text-primary shadow-workbench hover:bg-primary/5 disabled:opacity-50"
                  >
                    <FileQuestion className="h-3.5 w-3.5" />
                    生成题目
                  </button>
                  <button
                    onClick={handleAnalogy}
                    disabled={!agentConnected || turnActive}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/15 bg-white px-3 text-xs text-primary shadow-workbench hover:bg-primary/5 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    举一反三
                  </button>
                  <button
                    onClick={() => handleQuickAsk("请用通俗易懂的方式讲解当前知识点")}
                    disabled={!agentConnected || turnActive}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/15 bg-white px-3 text-xs text-primary shadow-workbench hover:bg-primary/5 disabled:opacity-50"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    概念讲解
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  className="min-h-[52px] flex-1 border-0 bg-transparent px-2 text-sm text-foreground placeholder:text-foreground-muted/60 focus:outline-none"
                  placeholder={
                    agentConnected
                      ? "输入问题..."
                      : pairingCode
                        ? "在电脑运行 local_agent.py 输入配对码 " + pairingCode
                        : "连接中..."
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={!agentConnected || turnActive}
                />
                <PrimaryButton
                  onClick={handleSend}
                  disabled={!input.trim() || !agentConnected || turnActive}
                  className="h-[52px] flex-shrink-0 rounded-full px-4"
                >
                  {turnActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </WorkbenchCard>
      </div>

      {extractModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#121c28]/30 px-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-outline-variant/80 bg-white shadow-float">
            <div className="flex items-center justify-between border-b border-outline-variant/70 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">提取结果</h3>
                <p className="text-sm text-foreground-muted">共识别 {extractModal.questions.length} 道题目</p>
              </div>
              <button onClick={() => setExtractModal(null)} className="rounded-md p-2 text-foreground-muted hover:bg-surface-low">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-auto px-5 py-4">
              {extractModal.questions.map((question, index) => (
                <div key={question.id ?? index} className="rounded-lg border border-outline-variant/70 bg-surface-low p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">题目 {index + 1}</span>
                    <StatusChip tone="success">
                      <CheckCircle2 className="h-3 w-3" />
                      已提取
                    </StatusChip>
                  </div>
                  <div className="text-sm leading-6 text-foreground whitespace-pre-wrap">{question.content || "无内容"}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-outline-variant/70 px-5 py-4">
              <PrimaryButton onClick={() => setExtractModal(null)}>知道了</PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
