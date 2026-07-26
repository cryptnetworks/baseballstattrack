import type { ApplicationStatus } from "@/server/app/status-service";

type StatusBadgeProps = {
  status: ApplicationStatus["status"];
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--line)] bg-white px-3 py-1 text-sm font-medium text-[var(--accent-strong)]">
      {status}
    </span>
  );
}
