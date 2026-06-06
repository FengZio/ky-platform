import { ReactNode } from "react";
import { Search, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function WorkbenchCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("workbench-card p-4 md:p-5", className)}>{children}</section>;
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="space-y-1">
        <h2 className="headline-md">{title}</h2>
        {description ? <p className="label-md">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  tone?: "primary" | "success" | "warning" | "secondary";
}) {
  const toneClass = {
    primary: "bg-primary/5 text-primary border-primary/10",
    success: "bg-success/10 text-success border-success/10",
    warning: "bg-secondary/20 text-warning-700 border-secondary/30",
    secondary: "bg-surface-low text-foreground border-outline-variant/70",
  }[tone];

  return (
    <WorkbenchCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="label-md">{label}</p>
          <div className="text-[28px] font-semibold leading-8 text-foreground">{value}</div>
          {hint ? <p className="label-md">{hint}</p> : null}
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-md border", toneClass)}>
          {icon}
        </div>
      </div>
    </WorkbenchCard>
  );
}

export function StatusChip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "error";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-low text-foreground-muted border-outline-variant/70",
    info: "bg-primary/10 text-primary border-primary/10",
    success: "bg-success/10 text-success border-success/10",
    warning: "bg-secondary/20 text-warning-700 border-secondary/30",
    error: "bg-error/10 text-error border-error/10",
  };

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function SubjectChip({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-foreground", className)}
      style={{ backgroundColor: color ? `${color}18` : undefined }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color ?? "#003fb1" }} />
      {children}
    </span>
  );
}

export function LinearProgress({
  value,
  className,
  trackClassName,
  barClassName,
}: {
  value: number;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
}) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className={cn("h-2 overflow-hidden rounded-full bg-surface-high", trackClassName)}>
        <div
          className={cn("h-full rounded-full bg-primary transition-all", barClassName)}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}

export function IconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md border border-outline-variant/80 bg-surface-lowest text-foreground-muted transition hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function BaseButton({
  children,
  className,
  variant,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant: "primary" | "secondary" }) {
  const variantClass =
    variant === "primary"
      ? "bg-primary text-white hover:bg-primary-700 border-primary"
      : "border border-primary/20 bg-surface-lowest text-primary hover:bg-primary/5";

  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variantClass,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <BaseButton variant="primary" {...props} />;
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <BaseButton variant="secondary" {...props} />;
}

export function WorkbenchInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("workbench-input", className)} />;
}

export function SearchInput({
  className,
  containerClassName,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) {
  return (
    <div className={cn("relative", containerClassName)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted/60" />
      <input {...props} className={cn("workbench-input pl-10", className)} />
    </div>
  );
}

export function EmptyStatePanel({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <WorkbenchCard className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
      {icon ? <div className="rounded-full bg-surface-low p-3 text-foreground-muted">{icon}</div> : null}
      <div className="space-y-1">
        <div className="headline-md">{title}</div>
        {description ? <p className="body-md text-foreground-muted">{description}</p> : null}
      </div>
      {action}
    </WorkbenchCard>
  );
}

export function InsightCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <WorkbenchCard className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {action ?? (
          <button className="text-foreground-muted transition hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </WorkbenchCard>
  );
}
