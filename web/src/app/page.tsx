"use client";

import { DesignCanvas } from "@/features/canvas/DesignCanvas";
import { useDesign } from "@/features/canvas/useDesign";
import { Inspector } from "@/features/inspector/Inspector";
import { Palette } from "@/features/palette/Palette";

/** Where a component clicked rather than dragged lands. Roughly the middle of
 *  the opening view, so it arrives on screen without landing on the client. */
const CLICK_DROP = { x: 340, y: 220 };

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
            controller.add(kind, CLICK_DROP);
          }}
        />
        <DesignCanvas controller={controller} />
        <Inspector
          node={controller.design.topology.nodes.find(
            (node) => node.id === controller.design.selected,
          )}
          onChange={controller.replace}
        />
      </div>
    </main>
  );
}
