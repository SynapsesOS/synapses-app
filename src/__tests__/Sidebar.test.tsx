import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { Sidebar } from "../components/Sidebar";

function renderSidebar(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it('renders the "Synapses" logo text', () => {
    renderSidebar();
    expect(screen.getByText("Synapses")).toBeDefined();
  });

  it("renders all 4 nav group labels", () => {
    renderSidebar();
    expect(screen.getByText("Control")).toBeDefined();
    expect(screen.getByText("Intelligence")).toBeDefined();
    expect(screen.getByText("Observe")).toBeDefined();
    expect(screen.getByText("System")).toBeDefined();
  });

  it("renders all 9 nav items", () => {
    renderSidebar();
    const expectedLabels = [
      "Dashboard",
      "Projects",
      "Agents",
      "Explorer",
      "Models & Brain",
      "Analytics",
      "Memory",
      "Privacy & Data",
      "Settings",
    ];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("renders nav items as links with correct href values", () => {
    renderSidebar();

    const expectedRoutes: [string, string][] = [
      ["Dashboard", "/"],
      ["Projects", "/projects"],
      ["Agents", "/agents"],
      ["Explorer", "/explorer"],
      ["Models & Brain", "/models"],
      ["Analytics", "/analytics"],
      ["Memory", "/memory"],
      ["Privacy & Data", "/privacy"],
      ["Settings", "/settings"],
    ];

    for (const [label, href] of expectedRoutes) {
      const link = screen.getByText(label).closest("a");
      expect(link, `Expected <a> for "${label}"`).not.toBeNull();
      expect(link!.getAttribute("href")).toBe(href);
    }
  });

  it('renders footer version text "v0.2.0"', () => {
    renderSidebar();
    expect(screen.getByText("v0.2.0")).toBeDefined();
  });

  it("marks the active route with the active class", () => {
    renderSidebar("/projects");
    const projectsLink = screen.getByText("Projects").closest("a");
    expect(projectsLink!.className).toContain("active");
  });

  it("does not mark inactive routes as active", () => {
    renderSidebar("/projects");
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink!.className).not.toContain("active");
  });
});
