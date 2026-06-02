// ============================================================
// Edge Function: parse-document (v2 - lightweight)
// ============================================================
// 接收前端提取好的文本, 分块 + 向量化存入 material_chunks。
// PDF 解析已移至前端 (浏览器端 pdfjs-dist 更稳定)。
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
};

// ─── 题目边界正则 ─────────────────────────────────────────
// 匹配 "1.", "2、", "（3）", "(4)", "第5题", "一、", "二." 等
const QUESTION_BOUNDARY = /\n(?=\d+[\.\、\．\)）]|（\d+）|\(\d+\)|第\d+题|[一二三四五六七八九十]+[\.\、\．])/;

// ─── 智能文本分块 ─────────────────────────────────────────
// 按题目边界切分，每道题独立成块，题与题之间不跨块合并
// ─── 知识点标签映射 ────────────────────────────────────────
const KNOWLEDGE_TAGS: Record<string, string> = {
  "单链表":"单链表","双链表":"双链表","循环链表":"循环链表","链表":"链表",
  "栈":"栈","队列":"队列","二叉树":"二叉树","二叉搜索树":"二叉搜索树",
  "平衡二叉树":"平衡二叉树","AVL":"平衡二叉树","红黑树":"红黑树",
  "B树":"B树与B+树","B+树":"B树与B+树","堆":"堆","优先队列":"优先队列",
  "哈希表":"哈希表","散列表":"哈希表","图":"图",
  "DFS":"深度优先搜索","BFS":"广度优先搜索","深度优先":"深度优先搜索","广度优先":"广度优先搜索",
  "排序":"排序","快速排序":"快速排序","归并排序":"归并排序","堆排序":"堆排序","冒泡排序":"冒泡排序",
  "动态规划":"动态规划","贪心":"贪心算法","递归":"递归","分治":"分治法","回溯":"回溯法",
  "极限":"极限与连续","连续":"极限与连续","导数":"导数与微分","微分":"导数与微分",
  "积分":"积分学","定积分":"积分学","不定积分":"积分学",
  "多元函数":"多元函数微分学","偏导数":"多元函数微分学","全微分":"多元函数微分学","级数":"无穷级数",
  "特征值":"特征值与特征向量","特征向量":"特征值与特征向量","行列式":"行列式","矩阵":"矩阵",
  "选择题":"选择题型","填空题":"填空题型","计算题":"计算题型","证明题":"证明题型",
  "快慢指针":"快慢指针","反转链表":"反转链表",
};

function extractKnowledgePoints(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [keyword, kpName] of Object.entries(KNOWLEDGE_TAGS)) {
    if (text.includes(keyword) && !seen.has(kpName)) {
      found.push(kpName);
      seen.add(kpName);
    }
  }
  return found;
}

// ─── Markdown 结构切分正则 ─────────────────────────────────
const HEADER_PATTERNS: [RegExp, string][] = [
  [/\n(?=####\s*题\d+)/, "question"],
  [/\n(?=【例題】|【例题】|【经典例题】|【题目】)/, "question"],
  [/\n(?=###\s*(?:知识|【知识|考点|【考点|章|节))/, "knowledge"],
  [/\n(?=##\s)/, "knowledge"],
  [/\n(?=\d+[\.\、\．\)）]\s)/, "question"],
];

// ─── 智能文本分块 ─────────────────────────────────────────
function chunkText(text: string, maxChars = 400): { content: string; chunk_type: string; knowledge_points: string[] }[] {
  const workText = "\n" + text;

  // 找所有分割点
  const boundaries: { pos: number; type: string }[] = [];
  for (const [pattern, ctype] of HEADER_PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(workText)) !== null) {
      const pos = m.index + m[0].length; // \n 之后
      if (!boundaries.some((b) => Math.abs(pos - b.pos) < 5)) {
        boundaries.push({ pos, type: ctype });
      }
    }
  }
  boundaries.sort((a, b) => a.pos - b.pos);

  if (boundaries.length === 0) {
    return [{ content: text.trim(), chunk_type: "question", knowledge_points: extractKnowledgePoints(text) }];
  }

  // 切出片段
  const raw: { content: string; type: string }[] = [];
  let currentType = "question";
  let prev = 0;

  for (const b of boundaries) {
    const origPos = b.pos - 1; // 去掉前缀 \n
    if (origPos < 0) { currentType = b.type; continue; }
    const segment = text.slice(prev, origPos).trim();
    if (segment) raw.push({ content: segment, type: currentType });
    currentType = b.type;
    prev = origPos;
  }

  const tail = text.slice(prev).trim();
  if (tail) raw.push({ content: tail, type: currentType });

  // 合并短 chunk
  const merged: { content: string; type: string }[] = [];
  let pending: { content: string; type: string } | null = null;
  for (const r of raw) {
    if (r.content.length < 30) {
      if (pending) {
        pending = { content: pending.content + "\n" + r.content, type: pending.type };
      } else {
        pending = r;
      }
    } else {
      if (pending) {
        merged.push({ content: pending.content + "\n" + r.content, type: pending.type });
        pending = null;
      } else {
        merged.push(r);
      }
    }
  }
  if (pending) {
    if (merged.length > 0) {
      merged[merged.length - 1] = { content: merged[merged.length - 1].content + "\n" + pending.content, type: merged[merged.length - 1].type };
    } else {
      merged.push(pending);
    }
  }

  // 组装结果
  return merged.map((r) => ({
    content: r.content,
    chunk_type: r.type,
    knowledge_points: extractKnowledgePoints(r.content),
  }));
}// ─── 获取 AI 配置 ──────────────────────────────────────────
async function getAiConfig(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data } = await supabase
    .from("ai_configs").select("*").eq("user_id", userId).eq("is_active", true).single();
  return {
    apiKey: data?.embed_api_key || data?.api_key || Deno.env.get("OPENAI_API_KEY") || "",
    baseUrl: data?.embed_base_url || data?.base_url || Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1",
    embedModel: data?.embed_model || data?.embedding_model || Deno.env.get("EMBEDDING_MODEL") || "text-embedding-3-small",
  };
}

// ─── 调用 Embedding API ────────────────────────────────────
async function getEmbedding(text: string, config: { apiKey: string; baseUrl: string; embedModel: string }): Promise<number[]> {
  const url = config.baseUrl.replace(/\/$/, "") + "/embeddings";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
    body: JSON.stringify({ model: config.embedModel, input: text.slice(0, 8000) }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error("Embedding API " + res.status + ": " + errBody.slice(0, 200));
  }
  const data = await res.json();
  const emb = data.data?.[0]?.embedding;
  if (!emb) throw new Error("No embedding returned");
  return emb;
}

// ─── 主入口 ────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing env vars" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Auth failed" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as {
      material_id: string;
      text?: string;         // 前端提取好的文本
      title?: string;
      type?: string;
      notes?: string;
    };

    const { material_id, text, title, type, notes } = body;
    if (!material_id) {
      return new Response(JSON.stringify({ error: "Missing material_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 查资料记录 (获取元信息)
    const { data: material } = await supabase
      .from("learning_materials").select("id, title, type, notes, file_type")
      .eq("id", material_id).single();

    // --- 处理文本 ---
    let finalText = "";
    if (text && text.trim()) {
      // 前端传了提取好的文本
      finalText = text.trim().slice(0, 50000);
    } else {
      // 降级: 用已有 content 或 notes
      const { data: mat } = await supabase
        .from("learning_materials").select("content, notes, title, type")
        .eq("id", material_id).single();
      finalText = (mat?.content || mat?.notes || "").slice(0, 50000);
    }

    if (!finalText.trim()) {
      return new Response(JSON.stringify({ error: "No text content" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[parse-document] Text length:", finalText.length);

    // --- 获取 AI 配置 ---
    const config = await getAiConfig(supabaseUrl, serviceRoleKey, user.id);
    if (!config.apiKey) {
      return new Response(JSON.stringify({ error: "No AI API key configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("[parse-document] Model:", config.embedModel);

    // --- 分块 ---
    const chunks = chunkText(finalText, 400);
    console.log("[parse-document] Chunks:", chunks.length);

    // --- 删旧 chunks ---
    await supabase.from("material_chunks").delete().eq("material_id", material_id);

    // --- 更新 material 的 content + 元数据向量 ---
    const metaTitle = title || material?.title || "";
    const metaType = type || material?.type || "";
    const metaNotes = notes || material?.notes || "";
    const metaText = "Material: " + metaTitle + ". Type: " + metaType + ". Notes: " + metaNotes;
    const metaEmbedding = await getEmbedding(metaText, config);
    await supabase.from("learning_materials").update({
      content: finalText,
      embedding: metaEmbedding,
      updated_at: new Date().toISOString(),
    }).eq("id", material_id);

    // --- 逐块向量化 ---
    let chunkCount = 0;
    let chunkCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const emb = await getEmbedding(chunks[i], config);
        await supabase.from("material_chunks").insert({
          material_id,
          chunk_index: i,
          content: chunks[i],
          embedding: emb,
        });
        chunkCount++;
        if (i % 10 === 0) console.log("[parse-document] Chunk", i + 1, "/", chunks.length);
      } catch (e) {
        console.error("[parse-document] Chunk", i, "failed:", e);
        await supabase.from("material_chunks").insert({
          material_id,
          chunk_index: i,
          content: chunks[i],
        });
      }
    }

    console.log("[parse-document] Done:", chunkCount, "/", chunks.length);

    return new Response(JSON.stringify({
      success: true,
      material_id,
      text_length: finalText.length,
      chunks_total: chunks.length,
      chunks_embedded: chunkCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("parse-document error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Server error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});