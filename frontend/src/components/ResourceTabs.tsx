import { cn } from "@/lib/utils";

export type ResourceTabKey = "knowledge" | "materials" | "questions" | "tasks";

const RESOURCE_TABS: { key: ResourceTabKey; label: string }[] = [
  { key: "knowledge", label: "知识体系" },
  { key: "materials", label: "学习资料" },
  { key: "questions", label: "题库" },
  { key: "tasks", label: "任务" },
];

interface ResourceTabsProps {
  activeTab: ResourceTabKey;
  onChange: (tab: ResourceTabKey) => void;
}

export function ResourceTabs({ activeTab, onChange }: ResourceTabsProps) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
      {RESOURCE_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            activeTab === tab.key
              ? "bg-primary-600 text-white"
              : "bg-white dark:bg-gray-900 border text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
