import { cn } from "@/lib/utils";
import { Library, BookOpen, Files, Brain, ListChecks } from "lucide-react";

export type ResourceTabKey = "knowledge" | "materials" | "questions" | "tasks";

const RESOURCE_TABS: { key: ResourceTabKey; label: string; icon: typeof Library }[] = [
  { key: "knowledge", label: "知识体系", icon: BookOpen },
  { key: "materials", label: "学习资料", icon: Files },
  { key: "questions", label: "题库", icon: Brain },
  { key: "tasks", label: "任务", icon: ListChecks },
];

interface ResourceTabsProps {
  activeTab: ResourceTabKey;
  onChange: (tab: ResourceTabKey) => void;
}

export function ResourceTabs({ activeTab, onChange }: ResourceTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {RESOURCE_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
            activeTab === tab.key
              ? "border-primary bg-primary text-white shadow-workbench"
              : "border-outline-variant/80 bg-white text-foreground-muted hover:bg-surface-low hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
          {tab.label}
        </button>
      )})}
    </div>
  );
}
