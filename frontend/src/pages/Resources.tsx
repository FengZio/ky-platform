import { useSearchParams } from "react-router-dom";
import { ResourceTabKey, ResourceTabs } from "@/components/ResourceTabs";
import { WorkspacePageShell } from "@/components/WorkspacePageShell";
import {
  InsightCard,
  PrimaryButton,
  SearchInput,
  SectionHeader,
  SecondaryButton,
  StatusChip,
  WorkbenchCard,
} from "@/components/workbench";
import Knowledge from "@/pages/Knowledge";
import Materials from "@/pages/Materials";
import QuestionBank from "@/pages/QuestionBank";
import TaskQueue from "@/pages/TaskQueue";
import { Bot, Filter, FolderPlus, Upload } from "lucide-react";

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
      actions={
        <>
          <SecondaryButton>
            <Upload className="h-4 w-4" />
            导入
          </SecondaryButton>
          <PrimaryButton>
            <FolderPlus className="h-4 w-4" />
            新建资源
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-5">
        <ResourceTabs activeTab={activeTab} onChange={handleTabChange} />

        <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/60 bg-surface-low p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              containerClassName="w-full max-w-md"
              placeholder={
                activeTab === "knowledge"
                  ? "搜索知识点、章节或描述"
                  : activeTab === "materials"
                    ? "搜索资料名称或文件类型"
                    : activeTab === "questions"
                      ? "搜索题目内容或解析"
                      : "搜索任务"
              }
            />
            <div className="flex items-center gap-2">
              <StatusChip tone="neutral">
                <Filter className="h-3.5 w-3.5" />
                统一筛选区
              </StatusChip>
              <StatusChip tone="info">当前模块: {activeTab}</StatusChip>
            </div>
          </div>
          <div className="text-xs text-foreground-muted">URL 参数已与资源库 tab 同步</div>
        </div>

        {activeTab === "knowledge" ? (
          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-6">
              <InsightCard title="掌握概览">
                <div className="space-y-3 text-sm text-foreground-muted">
                  <p>知识体系视图保留当前树结构与编辑能力，左侧补足概览与 AI 洞察位。</p>
                  <StatusChip tone="success">已掌握 / 进行中 / 需复习</StatusChip>
                </div>
              </InsightCard>
              <InsightCard title="AI 洞察" action={<StatusChip tone="warning">实验中</StatusChip>}>
                <div className="flex items-start gap-3 rounded-lg bg-secondary/10 p-4">
                  <Bot className="mt-0.5 h-4 w-4 text-secondary-700" />
                  <p className="text-sm leading-6 text-foreground">
                    后续这里会承接知识缺口提示、易错章节提醒和复习优先级建议。
                  </p>
                </div>
              </InsightCard>
            </div>
            <WorkbenchCard className="space-y-4">
              <SectionHeader title="知识层级树" description="保留现有逻辑，先纳入统一资源工作区外壳。" />
              <Knowledge embedded />
            </WorkbenchCard>
          </div>
        ) : null}

        {activeTab === "materials" ? (
          <WorkbenchCard className="space-y-4">
            <SectionHeader title="学习资料台账" description="资料列表、WebDAV 浏览和科目关联统一在同一工作区内呈现。" />
            <Materials embedded />
          </WorkbenchCard>
        ) : null}

        {activeTab === "questions" ? (
          <WorkbenchCard className="space-y-4">
            <SectionHeader title="题库工作台" description="保留筛选、批量操作与加入计划能力，先完成统一视觉收敛。" />
            <QuestionBank embedded />
          </WorkbenchCard>
        ) : null}

        {activeTab === "tasks" ? (
          <WorkbenchCard className="space-y-4">
            <SectionHeader title="任务状态面板" description="PDF 导出和资料解析任务统一归入资源库内查看。" />
            <TaskQueue embedded />
          </WorkbenchCard>
        ) : null}
      </div>
    </WorkspacePageShell>
  );
}
