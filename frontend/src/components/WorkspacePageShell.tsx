import { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
    <div className={cn("mx-auto max-w-workbench space-y-6", contentClassName)}>
      <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/60 bg-surface-low px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="headline-lg">{title}</h1>
          {description ? (
            <p className="body-md text-foreground-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
