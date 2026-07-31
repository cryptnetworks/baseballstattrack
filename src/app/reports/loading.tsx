import { ApplicationShell } from "@/components/app/application-shell";
import { RouteLoading } from "@/components/ui/route-loading";

export default function ReportsLoading() {
  return (
    <ApplicationShell>
      <RouteLoading label="Loading current report data…" />
    </ApplicationShell>
  );
}
