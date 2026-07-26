// StatusPill: renders a document's ingestion status (FR-11).
// Single responsibility: map a DocumentStatus to a label and tone.

import Pill from "@/components/ui/Pill";
import type { PillTone } from "@/components/ui/Pill";
import type { DocumentStatus } from "@/types";

interface StatusPillProps {
  status: DocumentStatus;
}

/**
 * Ingestion is synchronous, so in practice a document is `ready` by the
 * time the upload response lands. `pending` and `processing` are still
 * modelled because the API can return them and the UI must not render a
 * blank where a status should be.
 */
const STATUS_STYLE: Record<DocumentStatus, { label: string; tone: PillTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  processing: { label: "Processing", tone: "blue" },
  ready: { label: "Ready", tone: "emerald" },
  failed: { label: "Failed", tone: "red" },
};

export default function StatusPill({ status }: StatusPillProps): JSX.Element {
  const style = STATUS_STYLE[status];
  return <Pill tone={style.tone}>{style.label}</Pill>;
}
