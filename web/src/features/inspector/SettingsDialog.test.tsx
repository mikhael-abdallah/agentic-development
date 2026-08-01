import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsDialog } from "@/features/inspector/SettingsDialog";
import { newNode } from "@/lib/topology";

const NO_WIRING = { incoming: [], outgoing: [] };

function dialogOf(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector("dialog");
  if (dialog === null) {
    throw new Error("the settings rendered without a dialog");
  }
  return dialog;
}

function show(open: boolean, onClose = vi.fn()) {
  const result = render(
    <SettingsDialog
      node={newNode("cache", "cache", "Key cache")}
      operations={["resolve", "shorten"]}
      wiring={NO_WIRING}
      open={open}
      onChange={vi.fn()}
      onRemove={vi.fn()}
      onClose={onClose}
    />,
  );
  return { ...result, onClose };
}

// A native <dialog>, so the focus trap, the inert background and the backdrop
// are the browser's rather than four things to get right here. What this file
// can assert is the part that is this component's: that the element is opened
// and closed to match the prop, and that every way of dismissing it tells the
// page — including the two that never touch the button.
describe("SettingsDialog", () => {
  it("stays shut until it is opened", () => {
    const { container } = show(false);
    expect(dialogOf(container).open).toBe(false);
  });

  it("shows the settings of the component it was given", () => {
    show(true);
    expect(screen.getByRole("heading", { name: "Key cache" })).toBeDefined();
    expect(screen.getByLabelText("Hit ratio")).toBeDefined();
  });

  it("closes when the work is done", () => {
    const { onClose } = show(true);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Escape closes a native dialog without asking anything, so the page finds
  // out through the element's own close event. Without this the dialog would be
  // shut and the page would still believe it was open, and clicking the same
  // component again would appear to do nothing.
  it("tells the page when the dialog closes itself", () => {
    const { container, onClose } = show(true);
    fireEvent(dialogOf(container), new Event("close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open while it is being used", () => {
    const { onClose } = show(true);
    fireEvent.click(screen.getByRole("heading", { name: "Key cache" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
