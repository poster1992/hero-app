import { Fragment } from "react";
import PipelineNode from "@/components/PipelineNode";
import type { ProjectPipeline, PipelineProjectRef } from "@/lib/hero-api";

interface PipeNode {
  label: string;
  /** Substring used to match the step label; defaults to `label`. */
  needle?: string;
}

const PIPELINE_1: PipeNode[] = [
  { label: "Kontaktanfrage" },
  { label: "Angebotserstellung" },
  { label: "Angebot offen" },
  { label: "Wartezustand" },
  { label: "Angebot abgelehnt" },
];

const PIPELINE_2: PipeNode[] = [
  { label: "Auftragsbestätigung" },
  { label: "Arbeitsplanung" },
  { label: "Materialbestellung" },
  { label: "Montage-Dokumentation" },
  { label: "Laufende Projekte" },
  { label: "Schlussrechnung" },
  { label: "Nachkalkulation" },
];

// Brand ramp: neutral gray (start) → FloorTec red (end).
const GRAY: [number, number, number] = [82, 82, 91];
const RED: [number, number, number] = [232, 57, 42];

function rampStyle(t: number): React.CSSProperties {
  const mix = GRAY.map((g, i) => Math.round(g + (RED[i] - g) * t));
  const dark = mix.map((v) => Math.round(v * 0.78));
  return {
    backgroundImage: `linear-gradient(135deg, rgb(${mix.join(",")}), rgb(${dark.join(",")}))`,
  };
}

function projectsFor(pipeline: ProjectPipeline, needle: string): PipelineProjectRef[] {
  const stage = pipeline.stages.find((s) =>
    s.label.toLowerCase().includes(needle.toLowerCase())
  );
  return stage?.projects ?? [];
}

function ArrowRight() {
  return (
    <div className="flex h-24 shrink-0 items-center justify-center text-xl text-gray-600">→</div>
  );
}

function PipelineRow({
  title,
  nodes,
  pipeline,
  showOffer = false,
}: {
  title: string;
  nodes: PipeNode[];
  pipeline: ProjectPipeline;
  showOffer?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{title}</h2>
      <div className="flex items-center gap-1.5">
        {nodes.map((n, i) => (
          <Fragment key={n.label}>
            {i > 0 && <ArrowRight />}
            <PipelineNode
              label={n.label}
              projects={projectsFor(pipeline, n.needle ?? n.label)}
              style={rampStyle(nodes.length > 1 ? i / (nodes.length - 1) : 0)}
              showOffer={showOffer}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export default function ProjectPipelines({ pipeline }: { pipeline: ProjectPipeline }) {
  return (
    <div className="flex flex-col gap-8">
      <PipelineRow title="Pipeline 1 · Akquise" nodes={PIPELINE_1} pipeline={pipeline} showOffer />
      <PipelineRow title="Pipeline 2 · Umsetzung" nodes={PIPELINE_2} pipeline={pipeline} />
    </div>
  );
}
