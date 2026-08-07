import type { ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  tabIndex?: number;
};

export function PageShell({
  children,
  className = "",
  id = "main-content",
  tabIndex = -1,
}: PageShellProps) {
  return (
    <main className={`ui-page ${className}`.trim()} id={id} tabIndex={tabIndex}>
      {children}
    </main>
  );
}

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: SectionHeaderProps) {
  return (
    <header className="ui-page-header">
      <div>
        {eyebrow ? <p className="ui-kicker">{eyebrow}</p> : null}
        <h1 className="ui-title">{title}</h1>
        {description ? <p className="ui-description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-actions">{actions}</div> : null}
    </header>
  );
}

type SurfaceProps = {
  children: ReactNode;
  as?: "div" | "section" | "article";
  className?: string;
  labelledBy?: string;
};

export function Surface({
  children,
  as = "section",
  className = "",
  labelledBy,
}: SurfaceProps) {
  const Component = as;
  return (
    <Component
      aria-labelledby={labelledBy}
      className={`ui-surface ${className}`.trim()}
    >
      {children}
    </Component>
  );
}

type ActionLinkProps = {
  children: ReactNode;
  href: string;
  variant?: "primary" | "secondary" | "quiet";
  className?: string;
};

export function ActionLink({
  children,
  href,
  variant = "secondary",
  className = "",
}: ActionLinkProps) {
  return (
    <a
      className={`ui-action ui-action--${variant} ${className}`.trim()}
      href={href}
    >
      {children}
    </a>
  );
}

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty" role="status">
      <p className="ui-empty__title">{title}</p>
      <p className="ui-empty__description">{description}</p>
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}

type FeedbackStateProps = {
  tone: "success" | "error" | "warning" | "info";
  children: ReactNode;
  role?: "status" | "alert";
};

export function FeedbackState({
  tone,
  children,
  role = tone === "error" ? "alert" : "status",
}: FeedbackStateProps) {
  return (
    <p className={`ui-feedback ui-feedback--${tone}`} role={role}>
      {children}
    </p>
  );
}

export function Breadcrumbs({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className="ui-breadcrumbs">
      {children}
    </nav>
  );
}
