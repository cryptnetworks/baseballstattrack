import { ApplicationShell } from "@/components/app/application-shell";
import { RouteLoading } from "@/components/ui/route-loading";

export default function FantasyLoading() {
  return (
    <ApplicationShell>
      <RouteLoading label="Loading fantasy league" />
    </ApplicationShell>
  );
}
