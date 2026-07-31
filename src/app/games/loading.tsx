import { ApplicationShell } from "@/components/app/application-shell";
import { RouteLoading } from "@/components/ui/route-loading";

export default function GamesLoading() {
  return (
    <ApplicationShell>
      <RouteLoading label="Loading current game data…" />
    </ApplicationShell>
  );
}
