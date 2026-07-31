"use client";

import { DesignCanvas } from "@/features/canvas/DesignCanvas";
import { useDesign } from "@/features/canvas/useDesign";
import { Inspector } from "@/features/inspector/Inspector";
import { Palette } from "@/features/palette/Palette";
import { Library } from "@/features/simulation/Library";
import { SimulationPanel } from "@/features/simulation/SimulationPanel";

export default function Home() {
  const controller = useDesign();

  return (
    <main className="workspace">
      <header className="workspace__header">
        <h1>System Design Simulator</h1>
        <p>Assemble a system, then put load through it and watch where the queue forms.</p>
      </header>
      <div className="workspace__body">
        <Palette
          onAdd={(kind) => {
            controller.add(kind);
          }}
        />
        <DesignCanvas controller={controller} />
        <div className="workspace__side">
          <Inspector
            node={controller.design.topology.nodes.find(
              (node) => node.id === controller.design.selected,
            )}
            onChange={controller.replace}
          />
          <SimulationPanel topology={controller.design.topology} />
          <Library topology={controller.design.topology} onLoad={controller.load} />
        </div>
      </div>
    </main>
  );
}
