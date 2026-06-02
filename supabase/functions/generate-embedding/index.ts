// ============================================================
// Edge Function: generate-embedding
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
};

async function getAiConfig(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data } = await supabase
    .from("ai_configs")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  // 向量配置优先级: embed 专属字段 > 共享字段 > 环境变量
  return {
    apiKey:
      data?.embed_api_key ||
      data?.api_key ||
      Deno.env.get("OPENAI_API_KEY") ||
      "",
    baseUrl:
      data?.embed_base_url ||
      data?.base_url ||
      Deno.env.get("OPENAI_BASE_URL") ||
      "https://api.openai.com/v1",
    embedModel:
      data?.embed_model ||
      data?.embedding_model ||  // 兼容旧字段名 (迁移前)
      Deno.env.get("EMBEDDING_MODEL") ||
      "text-embedding-3-small",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token)
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user)
      return new Response(JSON.stringify({ error: "Auth failed" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { table, record } = (await req.json()) as {
      table: string;
      record: Record<string, unknown>;
    };
    if (!table || !record?.id)
      return new Response(
        JSON.stringify({ error: "Missing table or record.id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );

    const config = await getAiConfig(supabaseUrl, serviceRoleKey, user.id);
    if (!config.apiKey)
      return new Response(
        JSON.stringify({ error: "No AI API key configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );

    // --- 拼接文本 (优先使用 content 正文) ----------------------
    let text = "";
    const name = String(record.name ?? record.title ?? "");
    const desc = String(record.description ?? record.notes ?? "");
    const content = String(record.content ?? "");

    if (table === "knowledge_points") {
      text = "Knowledge point: " + name + ". Description: " + desc;
    } else if (table === "learning_materials") {
      const type = String(record.type ?? "");
      if (content.trim()) {
        text =
          "Material: " + name + ". Type: " + type + ". Content: " + content;
      } else {
        text =
          "Material: " + name + ". Type: " + type + ". Notes: " + desc;
      }
    }

    if (!text.trim())
      return new Response(JSON.stringify({ error: "No text content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // --- 调用 Embedding API ----------------------------------
    const url = config.baseUrl.replace(/\/$/, "") + "/embeddings";
    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        model: config.embedModel,
        input: text.slice(0, 8000),
      }),
    });
    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => "");
      throw new Error(
        "Embedding API " + apiRes.status + ": " + errBody.slice(0, 300),
      );
    }

    const apiData = await apiRes.json();
    const embedding = apiData.data?.[0]?.embedding;
    if (!embedding) throw new Error("No embedding returned");

    const { error: updateError } = await supabase
      .from(table)
      .update({ embedding })
      .eq("id", record.id as string);
    if (updateError)
      throw new Error("DB update failed: " + updateError.message);

    return new Response(
      JSON.stringify({
        success: true,
        table,
        id: record.id,
        embedding_dim: embedding.length,
        model: config.embedModel,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});