import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KnowledgePoint, Subject, LearningMaterial } from '@/types';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import {
  Brain, Send, Bot, User, Loader2, Sparkles,
  BookOpen, Lightbulb, RefreshCw, Search,
  Zap, Wifi, WifiOff, Copy, Check, ChevronDown,
  ChevronRight, FileText, Video, FileQuestion, StickyNote,
  X, FolderOpen, History, Plus, Trash2,
} from 'lucide-react';

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
};

type ContextItem = { id: string; name: string; type: 'kp' | 'material' };

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://vq.zrj666.cn';

export default function LearningCenter() {
  // ---- State ----
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', content: '欢迎来到 AI 学习中心！\n\n左侧可选择知识点或学习资料作为提问上下文，AI 将给出更精准的回答。' },
  ]);
  const [input, setInput] = useState('');
  const [agentConnected, setAgentConnected] = useState(false);
  const [turnActive, setTurnActive] = useState(false);
  const [selectedKpId, setSelectedKpId] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [materialSearch, setMaterialSearch] = useState('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'knowledge' | 'materials'>('knowledge');
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [selectedKps, setSelectedKps] = useState<ContextItem[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<ContextItem[]>([]);
  const [conversationId, setConversationId] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---- Data ----
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
      const { data } = await supabase.from('knowledge_points').select('*').order('sort_order');
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

  const filteredPoints = points?.filter((p) =>
    !searchText || p.name.includes(searchText) || p.description?.includes(searchText)
  );

  const filteredMaterials = materials?.filter((m) =>
    !materialSearch || m.title.includes(materialSearch)
  );

  // ---- WebSocket ----
  const connectWs = useCallback(() => {
    const protocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
    const host = BACKEND_URL.replace(/^https?:\/\//, '');
    const url = protocol + '://' + host + '/api/learning/ws';
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'pairing_code':
            setPairingCode(msg.code);
            break;
          case 'agent_connected':
            setAgentConnected(true);
            setMessages((prev) => [...prev, { role: 'system', content: '✅ 本地 Codex Agent 已连接，可以开始对话了！' }]);
            break;
          case 'agent_disconnected':
            setAgentConnected(false);
            setTurnActive(false);
            break;
          case 'assistant_chunk':
            setTurnActive(true);
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.isStreaming) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, content: last.content + msg.text };
                return updated;
              }
              return [...prev, { role: 'assistant', content: msg.text, isStreaming: true }];
            });
            break;
          case 'turn_completed':
            setTurnActive(false);
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.isStreaming) {
                updated[updated.length - 1] = { ...last, isStreaming: false };
              }
              return updated;
            });
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setAgentConnected(false);
      setTimeout(connectWs, 5000);
    };
  }, []);

  useEffect(() => { connectWs(); return () => wsRef.current?.close(); }, [connectWs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ---- Actions ----
  const toggleSubject = (sid: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  };

  const toggleKp = (kp: KnowledgePoint) => {
    setSelectedKps((prev) => {
      const exists = prev.find((c) => c.id === kp.id);
      if (exists) return prev.filter((c) => c.id !== kp.id);
      return [...prev, { id: kp.id, name: kp.name, type: 'kp' }];
    });
  };

  const toggleMaterial = (m: LearningMaterial & { subject_id?: string }) => {
    setSelectedMaterials((prev) => {
      const exists = prev.find((c) => c.id === m.id);
      if (exists) return prev.filter((c) => c.id !== m.id);
      return [...prev, { id: m.id, name: m.title, type: 'material' }];
    });
  };

  const removeContext = (item: ContextItem) => {
    if (item.type === 'kp') setSelectedKps((prev) => prev.filter((c) => c.id !== item.id));
    else setSelectedMaterials((prev) => prev.filter((c) => c.id !== item.id));
  };

  const getContextIds = () => ({
    kp_ids: selectedKps.map((k) => k.id),
    material_ids: selectedMaterials.map((m) => m.id),
  });

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !agentConnected || turnActive) return;

    // Display only the user's raw text, context injected server-side
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user_message', text: text, ...getContextIds() }));
    }

    // Save to DB
    if (conversationId) {
      await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: text,
        context_kp_ids: selectedKps.map((k) => k.id),
        context_material_ids: selectedMaterials.map((m) => m.id),
      });
    }
  };

  const handleQuickAsk = (prompt: string) => {
    if (!agentConnected || turnActive) return;
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user_message', text: prompt, ...getContextIds() }));
    }
  };

  
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

  const newConversation = async () => {
    const { data } = await supabase.from('chat_conversations').insert({ title: '新对话' }).select('id').single();
    if (data) {
      setConversationId(data.id);
      setMessages([{ role: 'system', content: '新对话已创建。左侧可选择知识点或学习资料作为上下文。' }]);
    }
  };

  const loadConversation = async (convId: string) => {
    setConversationId(convId);
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data.map((m) => ({ role: m.role, content: m.content })));
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

  // ---- Render ----
  return (
    <div className="flex h-[calc(100vh-4rem)]">
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
                                selected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300')}>
                                {selected && <Check className="w-2.5 h-2.5" />}
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
            <div className="p-1 space-y-0.5">
              {filteredMaterials?.map((m) => {
                const selected = selectedMaterials.some((c) => c.id === m.id);
                const subject = subjects?.find((s) => s.id === m.subject_id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleMaterial(m)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800',
                      selected && 'bg-primary-50 dark:bg-primary-900/20'
                    )}
                  >
                    <span className={cn('w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center',
                      selected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300')}>
                      {selected && <Check className="w-2.5 h-2.5" />}
                    </span>
                    <span className="text-gray-500">{materialIcon(m.type)}</span>
                    <span className="truncate flex-1">{m.title}</span>
                    {subject && (
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{subject.name}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversation history */}
        <div className="border-t p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-gray-400 flex items-center gap-1"><History className="w-3 h-3" />历史对话</span>
            <button onClick={newConversation} className="text-gray-400 hover:text-primary-600"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="space-y-0.5 max-h-32 overflow-auto">
            {conversations?.map((c: any) => (
              <button
                key={c.id}
                onClick={() => loadConversation(c.id)}
                className={cn('w-full text-left px-2 py-1 text-xs rounded truncate hover:bg-gray-100 dark:hover:bg-gray-800',
                  conversationId === c.id && 'bg-gray-100 dark:bg-gray-800')}
              >
                {c.title || '未命名对话'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Agent status + pairing code */}
        <div className="px-4 py-2 border-b flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn('w-2 h-2 rounded-full', agentConnected ? 'bg-emerald-500' : 'bg-gray-300')} />
            <span className={agentConnected ? 'text-emerald-600' : 'text-gray-500'}>
              {agentConnected ? 'Agent 已连接' : '等待 Agent 连接...'}
            </span>
          </div>
          {!agentConnected && pairingCode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono bg-white dark:bg-gray-800 px-2 py-0.5 rounded border">
                {pairingCode}
              </span>
              <button onClick={copyCode} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border hover:bg-gray-50">
                {codeCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {codeCopied ? '已复制' : '复制'}
              </button>
            </div>
          )}
        </div>

        {/* Context chips */}
        {(selectedKps.length > 0 || selectedMaterials.length > 0) && (
          <div className="px-4 py-2 border-b bg-gray-50 dark:bg-gray-800/30 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-400 mr-1">上下文:</span>
            {selectedKps.map((kp) => (
              <span key={kp.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                <BookOpen className="w-2.5 h-2.5" />{kp.name}
                <button onClick={() => removeContext(kp)}><X className="w-2.5 h-2.5 hover:text-red-500" /></button>
              </span>
            ))}
            {selectedMaterials.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full">
                <FileText className="w-2.5 h-2.5" />{m.name}
                <button onClick={() => removeContext(m)}><X className="w-2.5 h-2.5 hover:text-red-500" /></button>
              </span>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div className="px-4 py-2 border-b bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
          <button onClick={handleGenerateQuestion} disabled={!agentConnected || turnActive}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50">
            <Zap className="w-3.5 h-3.5" />出题测试</button>
          <button onClick={handleAnalogy} disabled={!agentConnected || turnActive}
            className="flex items-center gap-1 px-3 py-1.5 border border-violet-400 text-violet-600 dark:text-violet-400 rounded-lg text-xs font-medium hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-50">
            <Lightbulb className="w-3.5 h-3.5" />举一反三</button>
          <button
            onClick={() => {
              const all = [...selectedKps.map(k => k.name), ...selectedMaterials.map(m => m.name)];
              handleQuickAsk('请帮我解释「' + (all.join('、') || '当前知识点') + '」的核心概念和常见考法');
            }}
            disabled={!agentConnected || turnActive}
            className="flex items-center gap-1 px-3 py-1.5 border text-gray-600 dark:text-gray-400 rounded-lg text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
            概念讲解</button>
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
                {msg.role === 'assistant' ? (
                  <ReactMarkdown
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
                      hr: () => <hr className="my-2 border-gray-300 dark:border-gray-700" />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
                {msg.isStreaming && <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1 align-middle" />}
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
