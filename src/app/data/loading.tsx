import { ApplicationShell } from "@/components/app/application-shell";
import { RouteLoading } from "@/components/ui/route-loading";

export default function PortableDataLoading() {
  return (
    <ApplicationShell>
      <RouteLoading label="Loading authorized data tools…" />
    </ApplicationShell>
  );
}
