import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { backendFetch } from '@/lib/backend';
import { KnowledgePoint, Subject, LearningMaterial } from '@/types';
import { cn } from '@/lib/utils';
import { useLearningWs, type ChatMessage, type ContextItem } from '@/contexts/LearningWsContext';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  Brain, Send, Bot, User, Loader2, Sparkles,
  BookOpen, Lightbulb, RefreshCw, Search,
  Zap, Wifi, WifiOff, Copy, Check, ChevronDown,
  ChevronRight, FileText, Video, FileQuestion, StickyNote,
  X, FolderOpen, History, Plus, Trash2, FileDown, ListPlus, CheckCircle2, Database,
} from 'lucide-react';

// ---- Reasoning display ----
function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <div className="mb-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Brain className="w-3 h-3" />
        <span>思考过程{isStreaming ? '...' : ''}</span>
      </button>
      {open && (
        <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
          {text}
          {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-gray-300 animate-pulse ml-0.5 align-middle" />}
        </div>
      )}
    </div>
  );
}

export default function LearningCenter() {
  // ---- Context: persistent WS state across page switches ----
  const {
    messages, input, agentConnected, turnActive, pairingCode,
    conversationId, selectedKps, selectedMaterials,
    setInput, setConversationId, setMessages,
    toggleKp, toggleMaterial, removeContext,
    handleSend, handleQuickAsk, newConversation,
  } = useLearningWs();

  const [searchText, setSearchText] = useState('');
  const [materialSearch, setMaterialSearch] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [extractModal, setExtractModal] = useState<{ questions: any[] } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const [sidebarTab, setSidebarTab] = useState<'knowledge' | 'materials'>('knowledge');
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---- Data queries (cached by react-query) ----
  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').order('sort_order');
      return data as Subject[];
    },
  });

  const { data: points } = useQuery({
    queryKey: ['knowledge-points'],
    queryFn: async () => {
      const { data } = await supabase.from('knowledge_points').select('id,subject_id,parent_id,material_id,name,description,difficulty,importance,sort_order,is_mastered,mastered_at,created_at,updated_at').order('sort_order');
      return data as KnowledgePoint[];
    },
  });

  const { data: materials } = useQuery({
    queryKey: ['learning-materials'],
    queryFn: async () => {
      const { data } = await supabase
        .from('learning_materials')
        .select('id,title,type,subject_id,knowledge_point_id')
        .order('created_at', { ascending: false })
        .limit(100);
      return data as (LearningMaterial & { subject_id?: string; knowledge_point_id?: string })[];
    },
  });

  const { data: conversations } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: async () => {
      const { data } = await supabase
        .from('chat_conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20);
      return data;
    },
  });

  // Group knowledge points by subject
  const pointsBySubject = (points || []).reduce((acc, kp) => {
    const sid = kp.subject_id;
    if (!acc[sid]) acc[sid] = [];
    acc[sid].push(kp);
    return acc;
  }, {} as Record<string, KnowledgePoint[]>);

  const filteredMaterials = materials?.filter((m) =>
    !materialSearch || m.title.includes(materialSearch)
  ) ?? [];

  const materialsBySubject = filteredMaterials.reduce((acc, material) => {
    if (!material.subject_id) return acc;
    if (!acc[material.subject_id]) acc[material.subject_id] = [];
    acc[material.subject_id].push(material);
    return acc;
  }, {} as Record<string, (LearningMaterial & { subject_id?: string; knowledge_point_id?: string })[]>);

  const unassignedMaterials = filteredMaterials.filter((m) => !m.subject_id);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ---- Actions ----
  const toggleSubject = (sid: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  };

  const loadConversation = async (convId: string) => {
    setConversationId(convId);
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data.map((m: { role: string; content: string }) => ({ role: m.role as ChatMessage['role'], content: m.content })));
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(pairingCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const materialIcon = (type: string) => {
    switch (type) {
      case 'video': return <Video className="w-3 h-3" />;
      case 'exercise': return <FileQuestion className="w-3 h-3" />;
      case 'note': return <StickyNote className="w-3 h-3" />;
      default: return <FileText className="w-3 h-3" />;
    }
  };

  // Quick ask helpers
  const handleGenerateQuestion = () => {
    const allNames = [...selectedKps.map((k) => k.name), ...selectedMaterials.map((m) => m.name)];
    const topic = allNames.length > 0 ? allNames.join('、') : '当前知识点';
    handleQuickAsk('请根据「' + topic + '」出2道考研难度的题目，包含选择题和计算题，并给出详细解析。');
  };

  const handleAnalogy = () => {
    const allNames = [...selectedKps.map((k) => k.name), ...selectedMaterials.map((m) => m.name)];
    const topic = allNames.length > 0 ? allNames.join('、') : '当前知识点';
    handleQuickAsk('请围绕「' + topic + '」举一反三，给出2道变体题目，考察相同的核心概念但变换题型或角度。');
  };

  // ---- Markdown preprocessor: fix common AI output formatting issues ----
  const preprocessMarkdown = (text: string): string => {
    let result = text;

    // 1. Ensure blank line before table blocks
    result = result.replace(/([^\n])\n(\|[^\n]+\|\n\|[:\- ]+\|)/g, "$1\n\n$2");

    // 2. Fix alignment rows missing trailing pipe
    result = result.replace(/^(\|[ :\-]+\|[ :\-]+):$/gm, "$1|");

    return result;
  };

  // ---- LaTeX sanitizer: fix common AI output issues before rendering ----
  const sanitizeLatex = (text: string): string => {
    // 1. Remove zero-width and invisible Unicode characters
    let result = text
      .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '')
      .replace(/[\u2800-\u28FF]/g, '')  // Braille patterns (often appear as artifacts)
      .replace(/[\uFFF0-\uFFFF]/g, '')
      .replace(/[\u202A-\u202E]/g, '');

    // 2. Fix common mismatched delimiters
    result = result.replace(/(\$\$?)([^$]+?)(\$\$?)/g, (_, open, content, close) => {
      if (open !== close) {
        return '$' + content.trim() + '$';
      }
      return _;
    });

    // 3. Ensure $ blocks are on single lines (KaTeX requirement)
    result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_, content) => {
      const cleaned = content.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      return '$' + cleaned + '$';
    });

    return result;
  };

  // ---- Render ----
  // ---- Question Bank handlers ----
  const handleExtractToBank = async () => {
    setExtracting(true);
    try {
      const lastAssistant = [...messages].reverse().find((m: ChatMessage) => m.role === "assistant");
      if (!lastAssistant) return;
      const res = await backendFetch("/api/questions/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: lastAssistant.content,
          conversation_id: conversationId || undefined,
          knowledge_point_ids: selectedKps.map((k: ContextItem) => k.id),
        }),
      });
      const data = await res.json();
      setExtractModal({ questions: data.questions || [] });
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
      // 先提取题目，再提交导出任务
      const extractRes = await backendFetch("/api/questions/extract", {
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
      // 提交 PDF 导出任务
      const taskRes = await backendFetch("/api/tasks/queue/pdf-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_ids: ids }),
      });
      const taskData = await taskRes.json();
      alert("PDF 导出任务已提交！(" + ids.length + " 题)\n请在「任务队列」页面查看进度和下载。");
    } catch (e) {
      console.error("Export queue failed:", e);
    }
  };
  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-80 border-r flex flex-col bg-white dark:bg-gray-900">
        {/* Tab bar */}
        <div className="flex border-b">
          <button
            onClick={() => setSidebarTab('knowledge')}
            className={cn('flex-1 py-2.5 text-xs font-medium text-center border-b-2 transition-colors',
              sidebarTab === 'knowledge' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
          ><BookOpen className="w-3.5 h-3.5 inline mr-1" />知识点</button>
          <button
            onClick={() => setSidebarTab('materials')}
            className={cn('flex-1 py-2.5 text-xs font-medium text-center border-b-2 transition-colors',
              sidebarTab === 'materials' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
          ><FolderOpen className="w-3.5 h-3.5 inline mr-1" />学习资料</button>
        </div>

        {/* Search */}
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-2 rounded-lg border text-xs bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder={sidebarTab === 'knowledge' ? '搜索知识点...' : '搜索学习资料...'}
              value={sidebarTab === 'knowledge' ? searchText : materialSearch}
              onChange={(e) => sidebarTab === 'knowledge' ? setSearchText(e.target.value) : setMaterialSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {sidebarTab === 'knowledge' ? (
            <div className="p-1">
              {subjects?.map((subject) => {
                const subjectPoints = pointsBySubject[subject.id]?.filter((p) =>
                  !searchText || p.name.includes(searchText) || p.description?.includes(searchText)
                ) || [];
                if (subjectPoints.length === 0) return null;
                const expanded = expandedSubjects.has(subject.id);
                return (
                  <div key={subject.id} className="mb-0.5">
                    <button
                      onClick={() => toggleSubject(subject.id)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: subject.color || '#6366f1' }} />
                      {subject.name}
                      <span className="text-gray-400 ml-auto">{subjectPoints.length}</span>
                    </button>
                    {expanded && (
                      <div className="ml-4 border-l border-gray-200 dark:border-gray-700">
                        {subjectPoints.slice(0, 50).map((kp) => {
                          const selected = selectedKps.some((c) => c.id === kp.id);
                          return (
                            <button
                              key={kp.id}
                              onClick={() => toggleKp(kp)}
                              className={cn(
                                'w-full text-left px-2 py-1 text-xs rounded flex items-center gap-1.5 hover:bg-gray-100 dark:hover:bg-gray-800',
                                selected && 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                              )}
                            >
                              <span className={cn('w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center',
                                selected ? 'bg-primary-600 border-primary-600' : 'border-gray-300 dark:border-gray-600'
                              )}>
                                {selected && <Check className="w-2.5 h-2.5 text-white" />}
                              </span>
                              <span className="truncate">{kp.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-1">
              {subjects?.map((subject) => {
                const subjectMaterials = materialsBySubject[subject.id] || [];
                if (subjectMaterials.length === 0) return null;
                const expanded = expandedSubjects.has(subject.id);
                return (
                  <div key={subject.id} className="mb-0.5">
                    <button
                      onClick={() => toggleSubject(subject.id)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: subject.color || '#6366f1' }} />
                      {subject.name}
                      <span className="text-gray-400 ml-auto">{subjectMaterials.length}</span>
                    </button>
                    {expanded && (
                      <div className="ml-4 border-l border-gray-200 dark:border-gray-700">
                        {subjectMaterials.slice(0, 50).map((m) => {
                          const selected = selectedMaterials.some((c) => c.id === m.id);
                          return (
                            <button
                              key={m.id}
                              onClick={() => toggleMaterial(m)}
                              className={cn(
                                'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-1.5 hover:bg-gray-100 dark:hover:bg-gray-800',
                                selected && 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                              )}
                            >
                              <span className={cn('w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center',
                                selected ? 'bg-primary-600 border-primary-600' : 'border-gray-300 dark:border-gray-600'
                              )}>
                                {selected && <Check className="w-2.5 h-2.5 text-white" />}
                              </span>
                              {materialIcon(m.type)}
                              <span className="truncate">{m.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {unassignedMaterials.length > 0 && (
                <div className="mt-2 border-t border-gray-100 dark:border-gray-800 pt-2">
                  <div className="px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                    未关联科目 {unassignedMaterials.length}
                  </div>
                  {unassignedMaterials.slice(0, 20).map((m) => (
                    <div
                      key={m.id}
                      className="w-full px-2 py-1.5 text-xs rounded flex items-center gap-1.5 text-gray-400 cursor-not-allowed"
                      title="请先在学习资料页面手动关联学科"
                    >
                      <span className="w-3.5 h-3.5 rounded border border-gray-200 dark:border-gray-700 flex-shrink-0" />
                      {materialIcon(m.type)}
                      <span className="truncate">{m.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Chat Panel */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center justify-between bg-white dark:bg-gray-900">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary-600" />
            <span className="font-semibold text-sm">学习中心</span>
            <span className={cn('flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
              agentConnected ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
              'bg-gray-100 dark:bg-gray-800 text-gray-500')}>
              {agentConnected ? <><Wifi className="w-3 h-3" /> Codex Agent 已连接</> :
               pairingCode ? <><WifiOff className="w-3 h-3" /> 未连接</> :
               <><Loader2 className="w-3 h-3 animate-spin" /> 连接中...</>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {pairingCode && (
              <div className="flex items-center gap-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-lg">
                <span className="font-mono tracking-wider">{pairingCode}</span>
                <button onClick={copyCode} className="p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800 rounded">
                  {codeCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            )}
            <button onClick={newConversation}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 flex items-center gap-1">
              <Plus className="w-3 h-3" />新对话</button>
          </div>
        </div>

        {/* Conversation History */}
        {conversations && conversations.length > 0 && (
          <div className="px-5 py-2 border-b bg-gray-50 dark:bg-gray-900/50 flex items-center gap-2 overflow-x-auto">
            <History className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            {conversations.map((conv: { id: string; title: string }) => (
              <button
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className={cn('text-xs px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0',
                  conversationId === conv.id
                    ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100')}
              >
                {conv.title || '无标题'}
              </button>
            ))}
          </div>
        )}

        {/* Selected Context */}
        {(selectedKps.length > 0 || selectedMaterials.length > 0) && (
          <div className="px-5 py-2 border-b bg-violet-50 dark:bg-violet-900/10 flex items-center gap-2 flex-wrap">
            <Lightbulb className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
            <span className="text-xs text-violet-600 dark:text-violet-400">已选上下文:</span>
            {selectedKps.map((kp) => (
              <span key={kp.id} className="inline-flex items-center gap-1 text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">
                <BookOpen className="w-3 h-3" />{kp.name}
                <button onClick={() => removeContext(kp)}><X className="w-3 h-3" /></button>
              </span>
            ))}
            {selectedMaterials.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">
                <FileText className="w-3 h-3" />{m.name}
                <button onClick={() => removeContext(m)}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}

        {/* Quick Actions */}
        <div className="px-5 py-2 border-b flex gap-2 bg-white dark:bg-gray-900">
          <button onClick={handleGenerateQuestion} disabled={!agentConnected || turnActive}
            className="text-xs px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 flex items-center gap-1 disabled:opacity-50">
            <FileQuestion className="w-3.5 h-3.5" />生成题目</button>
          <button onClick={handleAnalogy} disabled={!agentConnected || turnActive}
            className="text-xs px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 flex items-center gap-1 disabled:opacity-50">
            <RefreshCw className="w-3.5 h-3.5" />举一反三</button>
          <button onClick={() => handleQuickAsk('请用通俗易懂的方式讲解当前知识点')} disabled={!agentConnected || turnActive}
            className="text-xs px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 flex items-center gap-1 disabled:opacity-50">
            <Zap className="w-3.5 h-3.5" />概念讲解</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={cn('flex gap-2 text-sm', msg.role === 'user' && 'justify-end', msg.role === 'system' && 'justify-center')}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-violet-600" />
                </div>
              )}
              <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 leading-relaxed',
                msg.role === 'user' ? 'bg-primary-600 text-white rounded-br-md' :
                msg.role === 'assistant' ? 'bg-gray-100 dark:bg-gray-800 rounded-bl-md prose prose-sm dark:prose-invert max-w-none' :
                'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs max-w-[90%]'
              )}>
                {msg.role === 'assistant' && msg.reasoning && (
                  <ReasoningBlock text={msg.reasoning} isStreaming={!!msg.isStreaming && !msg.content} />
                )}
                {msg.role === 'assistant' ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      h1: ({ children }) => <h1 className="text-lg font-bold mt-2 mb-1">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mt-1.5 mb-0.5">{children}</h3>,
                      ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
                      li: ({ children }) => <li className="text-sm">{children}</li>,
                      p: ({ children }) => <p className="my-1">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      code: ({ children, className }: any) =>
                        className
                          ? <code className="block bg-gray-200 dark:bg-gray-700 rounded px-2 py-1 my-1 text-xs overflow-x-auto">{children}</code>
                          : <code className="bg-gray-200 dark:bg-gray-700 rounded px-1 text-xs">{children}</code>,
                      pre: ({ children }) => <pre className="bg-gray-200 dark:bg-gray-700 rounded-lg p-2 my-1 overflow-x-auto text-xs">{children}</pre>,
                      a: ({ children, href }) => <a href={href} className="text-primary-600 underline" target="_blank" rel="noopener">{children}</a>,
                      blockquote: ({ children }) => <blockquote className="border-l-3 border-gray-300 dark:border-gray-600 pl-3 my-1 italic text-gray-600 dark:text-gray-400">{children}</blockquote>,
                      table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600 text-xs">{children}</table></div>,
                      thead: ({ children }) => <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>,
                      tbody: ({ children }) => <tbody className="divide-y divide-gray-200 dark:divide-gray-700">{children}</tbody>,
                      tr: ({ children }) => <tr className="border-b border-gray-200 dark:border-gray-700">{children}</tr>,
                      th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 min-w-[80px]">{children}</th>,
                      td: ({ children }) => <td className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 min-w-[80px]">{children}</td>,
                      hr: () => <hr className="my-2 border-gray-300 dark:border-gray-700" />,
                    }}
                  >
                    {sanitizeLatex(preprocessMarkdown(msg.content))}
                  </ReactMarkdown>
                ) : (
                  <span className="whitespace-pre-wrap">{sanitizeLatex(preprocessMarkdown(msg.content))}</span>
                )}
                {msg.isStreaming && <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1 align-middle" />}
                {msg.role === "assistant" && !msg.isStreaming && !turnActive && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <button onClick={handleExtractToBank} disabled={extracting}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-violet-50 dark:bg-violet-950/30 text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50 transition-colors">
                      {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                      提取到题库
                    </button>
                    <button onClick={handleExportToQueue}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                      <FileDown className="w-3 h-3" />
                      导出 PDF
                    </button>
                  </div>
                )}

              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t flex gap-2">
          <input
            className="flex-1 px-4 py-2.5 rounded-full border bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={agentConnected ? '输入问题...' : pairingCode ? '在电脑运行 local_agent.py 输入配对码 ' + pairingCode : '连接中...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={!agentConnected || turnActive}
          />
          <button onClick={handleSend} disabled={!input.trim() || !agentConnected || turnActive}
            className="w-11 h-11 rounded-full bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 disabled:opacity-40 flex-shrink-0">
            {turnActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
