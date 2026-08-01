import { ApplicationShell } from "@/components/app/application-shell";
import { RouteLoading } from "@/components/ui/route-loading";

export default function DiscordSettingsLoading() {
  return (
    <ApplicationShell>
      <RouteLoading label="Loading authorized Discord settings…" />
    </ApplicationShell>
  );
}
