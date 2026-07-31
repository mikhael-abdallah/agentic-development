import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Palette } from "@/features/palette/Palette";
import { kindLabel } from "@/lib/describe";
import { KIND_MIME } from "@/lib/drag";
import { NODE_KINDS } from "@/lib/topology";

describe("Palette", () => {
  it("offers every component kind the engine can simulate, in order", () => {
    render(<Palette onAdd={vi.fn()} />);
    const offered = screen
      .getAllByRole("button")
      .map((button) => button.querySelector(".palette__label")?.textContent);
    expect(offered).toEqual(NODE_KINDS.map(kindLabel));
  });

  // The button is not decoration: it is the keyboard path onto the canvas, and
  // a design surface that can only be driven by pointer is one a keyboard user
  // cannot use at all.
  it("adds a component when one is clicked", () => {
    const onAdd = vi.fn();
    render(<Palette onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /Load balancer/ }));
    expect(onAdd).toHaveBeenCalledWith("loadBalancer");
  });

  // The kind travels under its own MIME type. Under text/plain, anything
  // dragged in from another window would arrive looking like a component.
  it("puts the kind on the drag under the type the canvas reads", () => {
    render(<Palette onAdd={vi.fn()} />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: /Database/ }), {
      dataTransfer: { setData, effectAllowed: "none" },
    });
    expect(setData).toHaveBeenCalledWith(KIND_MIME, "database");
  });

  it("labels itself, so the region has a name in the accessibility tree", () => {
    render(<Palette onAdd={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Components" })).toBeDefined();
  });
});
