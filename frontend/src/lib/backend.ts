import { supabase } from "@/lib/supabase";

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://vq.zrj666.cn";

export async function backendFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", "Bearer " + token);
  }

  return fetch(BACKEND_URL + path, {
    ...init,
    headers,
  });
}

export async function getBackendWsUrl(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const protocol = BACKEND_URL.startsWith("https") ? "wss" : "ws";
  const host = BACKEND_URL.replace(/^https?:\/\//, "");
  const sep = path.includes("?") ? "&" : "?";
  return protocol + "://" + host + path + sep + "token=" + encodeURIComponent(token);
}
