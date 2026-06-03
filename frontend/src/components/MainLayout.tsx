import { ReactNode, useState } from "react";
import { LearningWsProvider } from "@/contexts/LearningWsContext";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarRange,
  BookOpen,
  FolderOpen,
  Settings,
  GraduationCap,
  Menu,
  LogOut,
  BarChart3,
  Brain, Library, History,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/plans", icon: CalendarRange, label: "长计划" },
  { to: "/knowledge", icon: BookOpen, label: "知识体系" },
  { to: "/materials", icon: FolderOpen, label: "学习资料" },
  { to: "/learning", icon: Brain, label: "AI 学习" },
  { to: "/queue", icon: History, label: "任务队列" },
  { to: "/questions", icon: Library, label: "题库" },
  { to: "/statistics", icon: BarChart3, label: "数据统计" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export function MainLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform lg:translate-x-0 lg:static lg:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 h-16 px-6 border-b border-gray-200 dark:border-gray-800">
          <GraduationCap className="w-7 h-7 text-primary-600" />
          <span className="font-bold text-lg">考研AI助手</span>
        </div>
        <nav className="p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                )
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 bg-white dark:bg-gray-900">
          <button
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setSidebarOpen(true)}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              {new Date().toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <LearningWsProvider>{children}</LearningWsProvider>
        </main>
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
      >
        <span className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 flex items-center justify-center text-xs font-bold">
          {user.email?.[0].toUpperCase() ?? "U"}
        </span>
        <span className="hidden sm:inline text-gray-600 dark:text-gray-400 max-w-[120px] truncate">
          {user.email}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-900 rounded-lg border shadow-lg z-20 py-1">
            <div className="px-3 py-2 text-xs text-gray-400 border-b truncate">{user.email}</div>
            <button
              onClick={() => { signOut(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}