import { ReactNode } from "react";

interface WorkspacePageShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function WorkspacePageShell({
  title,
  description,
  actions,
  children,
  contentClassName = "space-y-6",
}: WorkspacePageShellProps) {
  return (
    <div className={contentClassName}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
