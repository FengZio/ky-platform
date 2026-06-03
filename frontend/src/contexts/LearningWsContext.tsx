import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

// ---- Types ----
export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
};

export type ContextItem = { id: string; name: string; type: "kp" | "material" };

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://vq.zrj666.cn";

// Heartbeat: client sends ping every 30s to keep connection alive through proxies
const HEARTBEAT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// ---- Context Shape ----
interface LearningWsState {
  messages: ChatMessage[];
  input: string;
  agentConnected: boolean;
  turnActive: boolean;
  pairingCode: string;
  conversationId: string;
  selectedKps: ContextItem[];
  selectedMaterials: ContextItem[];
  setInput: (v: string) => void;
  setConversationId: (v: string) => void;
  setMessages: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  toggleKp: (kp: { id: string; name: string }) => void;
  toggleMaterial: (m: { id: string; title: string }) => void;
  removeContext: (item: ContextItem) => void;
  handleSend: () => void;
  handleQuickAsk: (prompt: string) => void;
  newConversation: () => Promise<void>;
}

const LearningWsContext = createContext<LearningWsState | null>(null);

export function LearningWsProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "system", content: "欢迎来到 AI 学习中心！\n\n左侧可选择知识点或学习资料作为提问上下文，AI 将给出更精准的回答。" },
  ]);
  const [input, setInput] = useState("");
  const [agentConnected, setAgentConnected] = useState(false);
  const [turnActive, setTurnActive] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [selectedKps, setSelectedKps] = useState<ContextItem[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<ContextItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempt = useRef(0);

  // ---- Client heartbeat: ping every 30s ----
  const startHeartbeat = useCallback((ws: WebSocket) => {
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    heartbeatTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_MS);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  // ---- WebSocket connection (persistent) ----
  const connectWs = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      try { wsRef.current.close(); } catch {}
    }

    const protocol = BACKEND_URL.startsWith("https") ? "wss" : "ws";
    const host = BACKEND_URL.replace(/^https?:\/\//, "");
    const url = protocol + "://" + host + "/api/learning/ws";
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "pairing_code":
            setPairingCode(msg.code);
            break;
          case "agent_connected":
            setAgentConnected(true);
            reconnectAttempt.current = 0;
            setMessages((prev) => [...prev, { role: "system", content: "✅ 本地 Codex Agent 已连接，可以开始对话了！" }]);
            break;
          case "agent_disconnected":
            setAgentConnected(false);
            setTurnActive(false);
            break;
          case "assistant_chunk":
            setTurnActive(true);
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && last.isStreaming) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, content: last.content + msg.text };
                return updated;
              }
              return [...prev, { role: "assistant", content: msg.text, isStreaming: true }];
            });
            break;
          case "turn_completed":
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
          case "pong":
            // heartbeat response - connection is alive
            break;
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      stopHeartbeat();
      setAgentConnected(false);
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt.current), RECONNECT_MAX_MS);
      reconnectAttempt.current += 1;
      console.log(`[WS] Disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttempt.current})`);
      reconnectTimer.current = setTimeout(connectWs, delay);
    };

    ws.onerror = (e) => {
      console.warn("[WS] Connection error", e);
    };
  }, [startHeartbeat, stopHeartbeat]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connectWs();
    return () => {
      stopHeartbeat();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        try { wsRef.current.close(); } catch {}
      }
    };
  }, [connectWs, stopHeartbeat]);

  // ---- Helpers ----
  const getContextIds = useCallback(() => ({
    kp_ids: selectedKps.map((k) => k.id),
    kp_names: selectedKps.map((k) => k.name),
    material_ids: selectedMaterials.map((m) => m.id),
    material_names: selectedMaterials.map((m) => m.name),
  }), [selectedKps, selectedMaterials]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !agentConnected || turnActive) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "user_message", text, ...getContextIds() }));
    }

    if (conversationId) {
      await supabase.from("chat_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: text,
        context_kp_ids: selectedKps.map((k) => k.id),
        context_material_ids: selectedMaterials.map((m) => m.id),
      });
    }
  }, [input, agentConnected, turnActive, conversationId, selectedKps, selectedMaterials, getContextIds]);

  const handleQuickAsk = useCallback((prompt: string) => {
    if (!agentConnected || turnActive) return;
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "user_message", text: prompt, ...getContextIds() }));
    }
  }, [agentConnected, turnActive, getContextIds]);

  const toggleKp = useCallback((kp: { id: string; name: string }) => {
    setSelectedKps((prev) => {
      const exists = prev.find((c) => c.id === kp.id);
      if (exists) return prev.filter((c) => c.id !== kp.id);
      return [...prev, { id: kp.id, name: kp.name, type: "kp" }];
    });
  }, []);

  const toggleMaterial = useCallback((m: { id: string; title: string }) => {
    setSelectedMaterials((prev) => {
      const exists = prev.find((c) => c.id === m.id);
      if (exists) return prev.filter((c) => c.id !== m.id);
      return [...prev, { id: m.id, name: m.title, type: "material" }];
    });
  }, []);

  const removeContext = useCallback((item: ContextItem) => {
    if (item.type === "kp") setSelectedKps((prev) => prev.filter((c) => c.id !== item.id));
    else setSelectedMaterials((prev) => prev.filter((c) => c.id !== item.id));
  }, []);

  const newConversation = useCallback(async () => {
    const { data } = await supabase.from("chat_conversations").insert({ title: "新对话" }).select("id").single();
    if (data) {
      setConversationId(data.id);
      setMessages([{ role: "system", content: "新对话已创建。左侧可选择知识点或学习资料作为上下文。" }]);
    }
  }, []);

  return (
    <LearningWsContext.Provider value={{
      messages, input, agentConnected, turnActive, pairingCode,
      conversationId, selectedKps, selectedMaterials,
      setInput, setConversationId, setMessages,
      toggleKp, toggleMaterial, removeContext,
      handleSend, handleQuickAsk, newConversation,
    }}>
      {children}
    </LearningWsContext.Provider>
  );
}

export function useLearningWs() {
  const ctx = useContext(LearningWsContext);
  if (!ctx) throw new Error("useLearningWs must be used within LearningWsProvider");
  return ctx;
}
