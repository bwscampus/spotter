import { Badge } from "@/components/ui/Badge";
import { TextLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import type { ChecklistStep } from "./checklist";

/** Home's first-run checklist: four steps, each with where to do it. */
export function GettingStarted({ steps }: { steps: ChecklistStep[] }) {
  return (
    <Panel heading="Getting started" className="lg:col-span-3">
      <ol>
        {steps.map((step, index) => (
          <li key={step.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
            <span className="w-4 shrink-0 font-num text-[12px] text-muted">{index + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold text-ink">{step.label}</span>
              <span className="text-[12px] text-muted">{step.detail}</span>
            </span>
            {step.done ? <Badge tone="green">Done</Badge> : <TextLink href={step.href}>{step.linkText}</TextLink>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
