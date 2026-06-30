"use client";

import { useEffect } from "react";
import { triggerWorkflowScan } from "@/app/dashboard/workflows/actions";

/** Unsichtbar: stößt bei App-Nutzung die (serverseitig gedrosselte) Workflow-Prüfung an. */
export default function WorkflowTrigger() {
  useEffect(() => {
    void triggerWorkflowScan().catch(() => {});
  }, []);
  return null;
}
