import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

/** The canvas alone. Every kind names itself twice on this page — once in the
 *  palette and once on whatever was added — so a query that does not say which
 *  one it means finds both. */
function canvasOf(container: HTMLElement): HTMLElement {
  const canvas = container.querySelector<HTMLElement>(".canvas");
  if (canvas === null) {
    throw new Error("the page rendered without a canvas");
  }
  return canvas;
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
    expect(within(canvasOf(container)).getByText("Client")).toBeDefined();
  });

  // The page is the only thing that holds both the palette and the canvas, so
  // it is the only place the two can be shown to be wired together.
  it("puts a component on the canvas when the palette is used", () => {
    const { container } = render(<Home />);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Service/ }));
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2);
    expect(within(canvasOf(container)).getByText("Service")).toBeDefined();
  });
})
;
