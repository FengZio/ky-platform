// ============================================================
// Edge Function: webdav-proxy (v4)
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PROPFIND",
};

interface WebdavFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: string;
  contentType: string;
}

/** UTF-8 safe Base64 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parsePropfindXml(xml: string, basePath: string): WebdavFile[] {
  const files: WebdavFile[] = [];

  const nsPatterns = [
    { rePrefix: "D:" },
    { rePrefix: "d:" },
    { rePrefix: "(?:d:|D:)?" },
  ];

  for (const { rePrefix } of nsPatterns) {
    const respRegex = new RegExp(
      "<" + rePrefix + "response>([\\s\\S]*?)<\\/" + rePrefix + "response>",
      "g"
    );
    const matches = [...xml.matchAll(respRegex)];
    if (matches.length === 0) continue;

    for (const m of matches) {
      const block = m[1];

      const getTag = (tag: string) => {
        const re = new RegExp("<" + rePrefix + tag + ">(.*?)<\\/" + rePrefix + tag + ">", "si");
        const m1 = block.match(re);
        return m1 ? m1[1].trim() : null;
      };

      const href = getTag("href");
      if (!href) continue;

      // Skip self
      let decoded: string;
      try { decoded = decodeURIComponent(href); } catch { decoded = href; }
      if (decoded === basePath || decoded === basePath + "/" || decoded === "/") continue;

      // Extract name from path
      const displayName = getTag("displayname");
      let name = displayName;
      if (!name) {
        const trimmed = decoded.endsWith("/") ? decoded.slice(0, -1) : decoded;
        const idx = trimmed.lastIndexOf("/");
        name = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
        if (!name) name = decoded;
        try { name = decodeURIComponent(name); } catch { /* keep */ }
      }

      const isCollection =
        new RegExp("<" + rePrefix + "collection", "i").test(block);

      files.push({
        name,
        path: decoded,
        isDirectory: isCollection,
        size: parseInt(getTag("getcontentlength") ?? "0"),
        lastModified: getTag("getlastmodified") ?? "",
        contentType: getTag("getcontenttype") ?? (isCollection ? "directory" : "application/octet-stream"),
      });
    }
    break;
  }

  return files;
}

function jsonError(message: string, status: number, hint?: string) {
  return new Response(JSON.stringify({ error: message, hint }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", 500);
    }

    let token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) token = new URL(req.url).searchParams.get("apikey");
    if (!token) return jsonError("未授权", 401, "请先登录");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonError("认证失败", 401, "请重新登录");

    const targetPath = new URL(req.url).searchParams.get("path") ?? "/";

    const { data: configs, error: configError } = await supabase
      .from("webdav_configs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1);

    if (configError) return jsonError("查询配置失败: " + configError.message, 500);
    if (!configs?.length) return jsonError("未配置 WebDAV", 400, "请在设置中添加");

    const config = configs[0];

    // Build PROPFIND URL pointing to the target directory
    const baseUrl = config.url.replace(/\/$/, "");
    const normalizedPath = targetPath === "/" ? "/" : "/" + targetPath.replace(/^\//, "").replace(/\/$/, "") + "/";
      // 逐段编码路径，避免 + # 等字符被 encodeURI 遗漏导致 WebDAV 挂起
  const webdavUrl = baseUrl + normalizedPath.split("/").map(s => s ? encodeURIComponent(s) : "").join("/");
    const authString = utf8ToBase64(config.username + ":" + config.password);

    // --- 下载模式: ?download=true 返回文件原始内容 ---
    const isDownload = new URL(req.url).searchParams.get("download") === "true";
    if (isDownload) {
            const downloadUrl = baseUrl + "/" + normalizedPath.replace(/\/$/, "").replace(/^\//, "").split("/").map(s => s ? encodeURIComponent(s) : "").join("/");
      console.log("[webdav-proxy] Downloading:", downloadUrl);
      let dlRes: Response;
      try {
        dlRes = await fetch(downloadUrl, {
          method: "GET",
          headers: { Authorization: "Basic " + authString },
          signal: AbortSignal.timeout(120_000), // 2 分钟超时
        });
      } catch (e) {
        return jsonError("下载超时或失败: " + (e instanceof Error ? e.message : String(e)), 502);
      }
      if (!dlRes.ok) {
        return jsonError("WebDAV " + dlRes.status + ": " + (dlRes.statusText || ""), 502);
      }
      // 流式转发: 不缓冲, 避免大文件 OOM
      const respHeaders = new Headers(corsHeaders);
      const ct = dlRes.headers.get("Content-Type");
      if (ct) respHeaders.set("Content-Type", ct);
      const cl = dlRes.headers.get("Content-Length");
      if (cl) respHeaders.set("Content-Length", cl);
      // 允许浏览器读取流式响应
      respHeaders.set("Transfer-Encoding", "chunked");
      return new Response(dlRes.body, { status: 200, headers: respHeaders });
    }

    // --- 浏览模式: PROPFIND ---
    const propfindBody = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<d:propfind xmlns:d="DAV:">',
      '  <d:prop>',
      '    <d:displayname/>',
      '    <d:getcontentlength/>',
      '    <d:getlastmodified/>',
      '    <d:getcontenttype/>',
      '    <d:resourcetype/>',
      '  </d:prop>',
      '</d:propfind>',
    ].join("\n");

    let response: Response;
    try {
      response = await fetch(webdavUrl, {
        method: "PROPFIND",
        headers: {
          Authorization: "Basic " + authString,
          Depth: "1",
          "Content-Type": "application/xml",
        },
        body: propfindBody,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      return jsonError("无法连接: " + (e instanceof Error ? e.message : String(e)), 502);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return jsonError("WebDAV " + response.status + (errText ? ": " + errText.slice(0, 200) : ""), 502);
    }

    const xml = await response.text();
    const allFiles = parsePropfindXml(xml, normalizedPath);

    // With Depth:1 on target, response contains only direct children (and self).
    // parsePropfindXml already skips self; no extra filter needed.
    const files = allFiles;

    return new Response(JSON.stringify({ path: targetPath, files, configName: config.name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("webdav-proxy:", error);
    return jsonError("服务器内部错误", 500);
  }
});