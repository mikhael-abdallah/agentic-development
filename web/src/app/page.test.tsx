import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** The page with its design surface actually on screen. The surface is fetched
 *  on demand — see DesignCanvas — so everything about what is drawn on it has
 *  to wait for it to arrive, and a test that did not wait would be asserting
 *  against the placeholder. */
async function pageWithCanvas(): Promise<HTMLElement> {
  const { container } = render(<Home />);
  await waitFor(() => {
    expect(container.querySelector(".react-flow__node")).not.toBeNull();
  });
  return container;
}

describe("Home", () => {
  it("renders the simulator heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "System Design Simulator" }),
    ).toBeDefined();
  });

  // What is deliberately not asserted here: that the canvas is absent on the
  // first frame. It is — the surface is fetched on demand — but only until
  // something has loaded the module, and this suite shuffles its tests, so any
  // assertion about the placeholder passes or fails depending on which test ran
  // first. The property that actually matters, that the surface stays out of
  // the first load, is held by the bundle budget: it is 190 kB with the split
  // and 244 kB without, against a gate of 244 kB.
  it("opens on a design with the one client every design needs", async () => {
    const container = await pageWithCanvas();
    expect(within(canvasOf(container)).getByText("Client")).toBeDefined();
  });

  // The page is the only thing that holds both the palette and the canvas, so
  // it is the only place the two can be shown to be wired together.
  it("puts a component on the canvas when the palette is used", async () => {
    const container = await pageWithCanvas();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Service/ }));
    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2);
    });
    expect(within(canvasOf(container)).getByText("Service")).toBeDefined();
  });
});
