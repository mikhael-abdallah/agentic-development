import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

/** The design alone. Every kind names itself twice on this page — once in the
 *  palette and once on whatever has been added — so a query that does not say
 *  which one it means finds both. */
function stageOf(container: HTMLElement): HTMLElement {
  const stage = container.querySelector<HTMLElement>(".stage");
  if (stage === null) {
    throw new Error("the page rendered without a design");
  }
  return stage;
}

describe("Home", () => {
  it("renders the simulator heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "System Design Simulator" }),
    ).toBeDefined();
  });

  it("opens on a design with the one client every design needs", () => {
    const { container } = render(<Home />);
    expect(within(stageOf(container)).getByText("Client")).toBeDefined();
  });

  // The page is the only thing that holds both the palette and the design, so
  // it is the only place the two can be shown to be wired together.
  it("adds a component to the design when the palette is used", () => {
    const { container } = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /Service/ }));
    const stage = within(stageOf(container));
    expect(stage.getByText("Service")).toBeDefined();
    expect(stage.getByText("4 × 8 ms")).toBeDefined();
  });

  it("keeps adding components rather than replacing the last one", () => {
    const { container } = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /Cache/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cache/ }));
    expect(stageOf(container).querySelectorAll(".stage__item")).toHaveLength(3);
  });
});
