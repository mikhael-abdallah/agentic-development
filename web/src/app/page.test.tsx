import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the simulator heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "System Design Simulator" }),
    ).toBeDefined();
  });

  it("shows the formatted example target", () => {
    const { container } = render(<Home />);
    expect(container.textContent).toContain("5.0k req/s");
    expect(container.textContent).toContain("120 ms p99");
  });
});
