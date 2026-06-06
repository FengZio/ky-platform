import { ReactNode, useMemo, useState } from "react";
import { LearningWsProvider } from "@/contexts/LearningWsContext";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "react-router-dom";
import {
  Bell,
  Brain,
  CalendarRange,
  CircleHelp,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/workbench";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "总览", hint: "学习指标与今日安排" },
  { to: "/learning", icon: Brain, label: "学习中心", hint: "AI 对话与上下文学习" },
  { to: "/resources", icon: Library, label: "资源库", hint: "知识点、资料、题库、任务" },
  { to: "/plans", icon: CalendarRange, label: "计划", hint: "长期学习路径与阶段管理" },
  { to: "/settings", icon: Settings, label: "设置", hint: "考试、AI 与同步配置" },
];

export function MainLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const todayText = useMemo(
    () =>
      new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
    [],
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#121c28]/25 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-outline-variant/70 bg-white px-4 py-4 transition-transform duration-200 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between rounded-lg border border-outline-variant/60 bg-surface-low px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-white shadow-workbench ring-1 ring-outline-variant/40">
              <img
                src="/favicon128×128.ico"
                alt="考研鸭"
                className="h-8 w-8 object-contain"
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">考研鸭</div>
              <div className="text-xs text-foreground-muted">AI 考研工作台</div>
            </div>
          </div>
          <button
            className="rounded-md p-2 text-foreground-muted transition hover:bg-surface-base lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-5 flex-1 space-y-1.5">
          {navItems.map(({ to, icon: Icon, label, hint }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition",
                  isActive
                    ? "bg-primary/8 text-primary"
                    : "text-foreground-muted hover:bg-surface-low hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "absolute bottom-2 left-0 top-2 w-1 rounded-r-full transition",
                      isActive ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-md border transition",
                      isActive
                        ? "border-primary/10 bg-primary/10 text-primary"
                        : "border-transparent bg-surface-low text-foreground-muted group-hover:bg-white",
                    )}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    <span className={cn("mt-0.5 block truncate text-xs", isActive ? "text-primary/75" : "text-foreground-muted/80")}>
                      {hint}
                    </span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="workbench-card space-y-3 bg-secondary/10 p-4">
          <div className="flex items-center gap-2 text-secondary-700">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-semibold">鸭鸭鼓励</span>
          </div>
          <p className="text-sm leading-6 text-foreground">
            今天先把最难的那一题啃掉，后面的节奏会顺很多。
          </p>
          <div className="rounded-md bg-white/80 px-3 py-2 text-xs text-foreground-muted">
            {todayText}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[240px]">
        <header className="sticky top-0 z-30 border-b border-outline-variant/70 bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-[76px] max-w-workbench items-center gap-4 px-4 md:px-6">
            <button
              className="rounded-md border border-outline-variant/70 bg-white p-2 text-foreground-muted shadow-workbench transition hover:bg-surface-low lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex-1" />

            <div className="hidden items-center gap-2 text-xs text-foreground-muted xl:flex">
              <span className="rounded-full bg-surface-low px-3 py-1.5">{todayText}</span>
            </div>

            <div className="flex items-center gap-2">
              <IconButton aria-label="通知">
                <Bell className="h-4 w-4" />
              </IconButton>
              <IconButton aria-label="帮助">
                <CircleHelp className="h-4 w-4" />
              </IconButton>
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6">
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
        className="flex items-center gap-3 rounded-full border border-outline-variant/70 bg-white py-1.5 pl-1.5 pr-3 shadow-workbench transition hover:bg-surface-low"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {user.email?.[0].toUpperCase() ?? "U"}
        </span>
        <span className="hidden max-w-[160px] truncate text-sm text-foreground-muted sm:inline">
          {user.email}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-outline-variant/80 bg-white p-2 shadow-float">
            <div className="border-b border-outline-variant/60 px-3 py-2 text-xs text-foreground-muted">
              {user.email}
            </div>
            <button
              onClick={() => {
                signOut();
                setOpen(false);
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-error transition hover:bg-error/5"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}
