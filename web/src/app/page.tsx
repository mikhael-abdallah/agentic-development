"use client";

import { useState } from "react";

import { DesignCanvas } from "@/features/canvas/DesignCanvas";
import { useDesign } from "@/features/canvas/useDesign";
import { SettingsDialog } from "@/features/inspector/SettingsDialog";
import { Palette } from "@/features/palette/Palette";
import { Library } from "@/features/simulation/Library";
import { SimulationPanel } from "@/features/simulation/SimulationPanel";
import { contractsOf } from "@/lib/describe";
import type { NodeKind } from "@/lib/topology";

export default function Home() {
  const controller = useDesign();
  // Whether the settings are up. Which component they are for is deliberately
  // not held here: it is whichever the design has selected, so there is one
  // answer to "what is being edited" rather than two that can disagree.
  const [editing, setEditing] = useState(false);
  const selected = controller.design.topology.nodes.find(
    (node) => node.id === controller.design.selected,
  );

  // A new component arrives already selected and already carrying ordinary
  // settings, so opening them on it needs nothing but saying so. The dialog is
  // there to change those settings, not to demand them: closing it without
  // touching anything leaves a component that runs.
  const addAndEdit = (kind: NodeKind) => {
    controller.add(kind);
    setEditing(true);
  };

  return (
    <main className="workspace">
      <header className="workspace__header">
        <h1>System Design Simulator</h1>
        <p>Assemble a system, then put load through it and watch where the queue forms.</p>
      </header>
      <div className="workspace__body">
        <Palette onAdd={addAndEdit} />
        <DesignCanvas
          controller={controller}
          onEdit={() => {
            setEditing(true);
          }}
        />
        <div className="workspace__side">
          <SimulationPanel topology={controller.design.topology} />
          <Library topology={controller.design.topology} onLoad={controller.load} />
        </div>
      </div>
      <SettingsDialog
        node={selected}
        wiring={contractsOf(controller.design.topology, selected?.id ?? "")}
        open={editing && selected !== undefined}
        onChange={controller.replace}
        onRemove={(id) => {
          controller.drop(id);
          setEditing(false);
        }}
        onClose={() => {
          setEditing(false);
        }}
      />
    </main>
  );
}
