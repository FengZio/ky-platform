import { useSearchParams } from "react-router-dom";
import { ResourceTabKey, ResourceTabs } from "@/components/ResourceTabs";
import { WorkspacePageShell } from "@/components/WorkspacePageShell";
import Knowledge from "@/pages/Knowledge";
import Materials from "@/pages/Materials";
import QuestionBank from "@/pages/QuestionBank";
import TaskQueue from "@/pages/TaskQueue";

const VALID_TABS: ResourceTabKey[] = ["knowledge", "materials", "questions", "tasks"];

function getActiveTab(value: string | null): ResourceTabKey {
  if (value && VALID_TABS.includes(value as ResourceTabKey)) {
    return value as ResourceTabKey;
  }
  return "knowledge";
}

export default function Resources() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = getActiveTab(searchParams.get("tab"));

  const handleTabChange = (tab: ResourceTabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <WorkspacePageShell
      title="资源库"
      description="统一管理知识点、学习资料、题库和任务状态。"
    >
      <ResourceTabs activeTab={activeTab} onChange={handleTabChange} />
      {activeTab === "knowledge" ? <Knowledge embedded /> : null}
      {activeTab === "materials" ? <Materials embedded /> : null}
      {activeTab === "questions" ? <QuestionBank embedded /> : null}
      {activeTab === "tasks" ? <TaskQueue embedded /> : null}
    </WorkspacePageShell>
  );
}
