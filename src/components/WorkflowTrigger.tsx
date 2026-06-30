"use client";

import { useEffect } from "react";
import { triggerWorkflowScan } from "@/app/dashboard/workflows/actions";

/**
 * Unsichtbar: stößt die (serverseitig auf 5 Min gedrosselte) Workflow-Prüfung an –
 * beim Laden, regelmäßig (alle 90 s) und wenn der Tab wieder aktiv wird.
 */
export default function WorkflowTrigger() {
  useEffect(() => {
    const fire = () => void triggerWorkflowScan().catch(() => {});
    fire();
    const interval = setInterval(fire, 90_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
