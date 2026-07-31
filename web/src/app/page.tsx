"use client";

import { useDesign } from "@/features/canvas/useDesign";
import { Palette } from "@/features/palette/Palette";
import { describeParams, kindLabel } from "@/lib/describe";

/** Every component lands here until there is a surface with coordinates on it.
 *  The design already carries positions; nothing reads them yet. */
const UNPLACED = { x: 0, y: 0 };

export default function Home() {
  const { design, add } = useDesign();

  return (
    <main className="workspace">
      <header className="workspace__header">
        <h1>System Design Simulator</h1>
        <p>Assemble a system, then put load through it and watch where the queue forms.</p>
      </header>
      <div className="workspace__body">
        <Palette
          onAdd={(kind) => {
            add(kind, UNPLACED);
          }}
        />
        <section className="stage" aria-label="Design">
          <ul className="stage__list">
            {design.topology.nodes.map((node) => (
              <li key={node.id} className={`stage__item stage__item--${node.kind}`}>
                <span className="stage__kind">{node.kind}</span>
                <span className="stage__name">{node.label ?? kindLabel(node.kind)}</span>
                <span className="stage__summary">{describeParams(node)}</span>
              </li>
            ))}
          </ul>
          <p className="stage__note">
            A surface to arrange these on, and connections between them, come next.
          </p>
        </section>
      </div>
    </main>
  );
}
