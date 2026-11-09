"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFlowStepAction } from "@/app/actions/master";
import { Alert } from "@/components/ui";

export function FlowToggle({ docType, stepOrder, active }: { docType: string; stepOrder: number; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="inline-flex min-h-[44px] items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              setError(null);
              const r = await setFlowStepAction(docType, stepOrder, e.target.checked);
              if (!r.ok) return setError(r.error.message);
              router.refresh();
            })
          }
        />
        {active ? "Aktif" : "Dimatikan"}
      </label>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
