import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { MessageCircle, Send, X, Bot, User, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "你好！我是考研AI助手 🤖 可以问我关于学习计划、知识点、备考策略等问题。比如：「今天该重点复习什么？」" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })) }),
      });
      const json = await res.json();
      if (json.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: json.reply }]);
      } else if (json.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: `❌ 错误: ${json.error} | 请先在设置→AI供应商中配置API密钥` }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "连接失败 (网络错误或CORS)" }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all",
          "bg-primary-600 hover:bg-primary-700 text-white",
          open && "scale-0"
        )}
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[520px] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary-600 text-white rounded-t-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <span className="font-semibold text-sm">考研AI助手</span>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-primary-700 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-2 text-sm",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary-600" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary-600 text-white rounded-br-md"
                      : "bg-gray-100 dark:bg-gray-800 rounded-bl-md"
                  )}
                >
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-gray-500" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 text-sm">
                <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary-600" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t flex gap-2">
            <input
              className="flex-1 px-4 py-2 rounded-full border bg-gray-50 dark:bg-gray-800 text-sm"
              placeholder="问点什么..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 disabled:opacity-50 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
