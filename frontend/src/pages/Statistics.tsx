import { BarChart3 } from "lucide-react";
import { OverviewStatistics } from "@/components/OverviewStatistics";

export default function Statistics() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="w-6 h-6 text-primary-500" />
        学习统计
      </h1>
      <OverviewStatistics />
    </div>
  );
}
