// ============================================================
// Edge Function: ai-chat
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
};

const SYSTEM_PROMPT = [
  "你是考研AI助手，帮助用户备考研究生入学考试。你可以：",
  "1. 根据用户的学习计划、知识点掌握情况提供学习建议",
  "2. 分析每日目标完成情况给出优化建议",
  "3. 根据薄弱知识点推荐复习重点",
  "4. 回答考研相关问题",
  "请用中文回复，简洁实用，每次200字以内。",
].join("\n");

async function getAiConfig(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data } = await supabase.from("ai_configs").select("*").eq("user_id", userId).eq("is_active", true).single();
  return {
    apiKey: data?.api_key || Deno.env.get("OPENAI_API_KEY") || "",
    baseUrl: data?.base_url || Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1",
    chatModel: data?.chat_model || Deno.env.get("CHAT_MODEL") || "gpt-4o-mini",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Auth failed" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { messages } = await req.json() as { messages: { role: string; content: string }[] };
    if (!messages?.length) return new Response(JSON.stringify({ error: "No messages" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const config = await getAiConfig(supabaseUrl, serviceRoleKey, user.id);
    if (!config.apiKey) return new Response(JSON.stringify({ error: "No AI API key configured" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // Gather user context
    const today = new Date().toISOString().slice(0, 10);
    const [examRes, goalRes, kpRes] = await Promise.all([
      supabase.from("exam_info").select("name, exam_date").eq("user_id", user.id).order("exam_date").limit(1),
      supabase.from("daily_goals").select("completion_rate, reflection, mood").eq("user_id", user.id).eq("date", today).single(),
      supabase.from("knowledge_points").select("name, is_mastered, importance").eq("user_id", user.id).order("importance", { ascending: false }).limit(20),
    ]);

    const exam = examRes.data?.[0];
    const goal = goalRes.data;
    const kps = kpRes.data ?? [];
    const weak = kps.filter(function(k: any) { return !k.is_mastered && k.importance >= 4; });

    let ctx = "";
    if (exam) {
      const days = Math.ceil((new Date(exam.exam_date).getTime() - Date.now()) / 86400000);
      ctx += "考试: " + exam.name + ", 倒计时" + days + "天。";
    }
    if (goal) {
      ctx += "今日完成率" + Math.round((goal.completion_rate ?? 0) * 100) + "%";
      if (goal.mood) ctx += ", 心情" + goal.mood + "/5";
      ctx += "。";
    }
    if (weak.length) {
      ctx += "薄弱知识点: " + weak.map(function(k: any) { return k.name; }).join("、") + "。";
    }

    const url = config.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const hasSystemMsg = messages.some((m: any) => m.role === "system");
    // 前端已传入 system prompt 时保留原样，否则拼接上下文
    const systemContent = hasSystemMsg
      ? messages.find((m: any) => m.role === "system")!.content
      : SYSTEM_PROMPT + "\n\n当前学习情况: " + (ctx || "暂无数据");
    // 分类任务只需少量 token，正常对话给更多
    const maxTokens = hasSystemMsg ? 20 : 512;
    const apiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify({
        model: config.chatModel,
        messages: [
          { role: "system", content: systemContent },
          ...messages.filter((m: any) => m.role !== "system"),
        ],
        max_tokens: maxTokens,
        temperature: 0,
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => "");
      throw new Error("Chat API " + apiRes.status + ": " + errBody.slice(0, 300));
    }

    const apiData = await apiRes.json();
    // 兼容多种 API 响应格式 (用 || 而非 ??, 因为某些模型的 content 可能为 "")
    // DeepSeek 推理模型: reasoning_content 含思考过程, content 含最终答案
    // 拼接两者确保拿到完整输出, 前端会从中提取数字
    const rawContent = apiData.choices?.[0]?.message?.content || "";
    const reasoningContent = apiData.choices?.[0]?.message?.reasoning_content || "";
    const reply = (reasoningContent + "\n" + rawContent).trim()
      || apiData.choices?.[0]?.text
      || apiData.choices?.[0]?.delta?.content
      || apiData.content
      || apiData.response
      || "";
    console.log("[ai-chat] status:", apiRes.status, "model:", config.chatModel, "reply:", JSON.stringify(reply).slice(0, 100));
    console.log("[ai-chat] choices count:", apiData.choices?.length ?? 0);
    if (!reply) {
      console.log("[ai-chat] EMPTY reply. Full response:", JSON.stringify(apiData).slice(0, 800));
      return new Response(JSON.stringify({
        reply: "",
        debug: { model: config.chatModel, choicesCount: apiData.choices?.length ?? 0, sampleKeys: Object.keys(apiData).slice(0,5) }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      reply
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Server error"
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
