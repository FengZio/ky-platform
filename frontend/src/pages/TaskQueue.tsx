import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { backendFetch } from "@/lib/backend";
import { cn } from "@/lib/utils";
import {
  Clock, FileDown, FileText, Download, Loader2, CheckCircle2,
  XCircle, RefreshCw, Trash2, History, ChevronRight,
} from "lucide-react";

interface TaskItem {
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

const STATUS_LABELS: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  queued: { label: "排队中", color: "text-gray-400 bg-gray-100 dark:bg-gray-800", icon: Clock },
  processing: { label: "处理中", color: "text-blue-500 bg-blue-50 dark:bg-blue-950", icon: Loader2 },
  done: { label: "已完成", color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950", icon: CheckCircle2 },
  failed: { label: "失败", color: "text-red-500 bg-red-50 dark:bg-red-950", icon: XCircle },
};

const TASK_TYPE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  pdf_export: { label: "PDF 导出", icon: FileDown },
  doc_parse: { label: "资料解析", icon: FileText },
};

export default function TaskQueue({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: tasks, isLoading, refetch } = useQuery({
    queryKey: ["task-queue"],
    queryFn: async () => {
      const res = await backendFetch("/api/tasks/queue?limit=30");
      if (res.status === 401) return [];
      return ((await res.json()).tasks || []) as TaskItem[];
    },
    refetchInterval: 3000, // auto-poll every 3s for active tasks
  });

  const handleDownload = async (task: TaskItem) => {
    setDownloading(task.id);
    try {
      const res = await backendFetch(`/api/tasks/queue/${task.id}/download`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const filename = (task.result_json as Record<string, string>)?.filename || "download.pdf";
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("Download failed:", e);
    } finally {
      setDownloading(null);
    }
  };

  const activeCount = (tasks || []).filter((t) => t.status === "queued" || t.status === "processing").length;

  return (
    <div className={embedded ? "space-y-6" : "max-w-3xl mx-auto space-y-6"}>
      <div className="flex items-center justify-between">
        <h1 className={cn("font-bold flex items-center gap-2", embedded ? "text-lg" : "text-2xl")}>
          <History className={embedded ? "w-5 h-5 text-primary-600" : "w-6 h-6 text-primary-600"} />
          任务队列
        </h1>
        <div className="flex items-center gap-3">
          {activeCount > 0 && (
            <span className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 rounded-full flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {activeCount} 个任务处理中
            </span>
          )}
          <button onClick={() => refetch()}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : !tasks || tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <History className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg">暂无任务</p>
          <p className="text-sm mt-1">PDF 导出或资料解析任务会显示在这里</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const statusCfg = STATUS_LABELS[task.status] || STATUS_LABELS.queued;
            const StatusIcon = statusCfg.icon;
            const typeCfg = TASK_TYPE_LABELS[task.task_type] || TASK_TYPE_LABELS.pdf_export;
            const TypeIcon = typeCfg.icon;
            const isActive = task.status === "queued" || task.status === "processing";

            return (
              <div key={task.id} className={cn(
                "bg-white dark:bg-gray-900 rounded-xl border p-4 transition-all",
                isActive ? "border-blue-200 dark:border-blue-800 ring-1 ring-blue-100" : "border-gray-200 dark:border-gray-800",
              )}>
                <div className="flex items-start gap-3">
                  {/* Type icon */}
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                    task.task_type === "pdf_export" ? "bg-violet-100 dark:bg-violet-950 text-violet-600" : "bg-amber-100 dark:bg-amber-950 text-amber-600"
                  )}>
                    <TypeIcon className="w-4.5 h-4.5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{typeCfg.label}</span>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", statusCfg.color)}>
                        <StatusIcon className={cn("w-3 h-3 inline mr-1", isActive && "animate-spin")} />
                        {statusCfg.label}
                      </span>
                      {task.task_type === "pdf_export" && task.result_json && (task.result_json as Record<string, unknown>).question_count != null && (
                        <span className="text-xs text-gray-400">
                          {(task.result_json as Record<string, number>).question_count} 题
                        </span>
                      )}
                    </div>

                    {/* Progress bar for active tasks */}
                    {isActive && (
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000"
                            style={{ width: `${task.progress_pct}%` }} />
                        </div>
                        {task.message && (
                          <p className="text-xs text-gray-400 mt-1 truncate">{task.message}</p>
                        )}
                      </div>
                    )}

                    {/* Failed message */}
                    {task.status === "failed" && task.message && (
                      <p className="text-xs text-red-500 mt-1 truncate">{task.message}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {task.status === "done" && task.task_type === "pdf_export" && (
                      <button onClick={() => handleDownload(task)} disabled={downloading === task.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                        {downloading === task.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        下载
                      </button>
                    )}
                  </div>
                </div>

                {/* Timestamp */}
                <div className="mt-2 ml-12 text-xs text-gray-400">
                  {new Date(task.created_at).toLocaleString("zh-CN")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
