import { Badge } from "@/components/ui/badge";
import type { ClientHealth } from "@/lib/domain/enums";
import { CLIENT_HEALTH_LABELS } from "@/lib/domain/labels";

const VARIANT: Record<ClientHealth, "onTrack" | "atRisk" | "delayed" | "onHold"> =
  {
    ON_TRACK: "onTrack",
    AT_RISK: "atRisk",
    DELAYED: "delayed",
    ON_HOLD: "onHold",
  };

/** Health rendered through the domain-semantic tokens, legible in both themes. */
export function HealthBadge({ health }: { health: ClientHealth }) {
  return (
    <Badge variant={VARIANT[health]}>{CLIENT_HEALTH_LABELS[health]}</Badge>
  );
}
