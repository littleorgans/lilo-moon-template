import { afterEach, describe, expect, it, vi } from "vitest";

const reactRoot = vi.hoisted(() => {
  const render = vi.fn();

  return {
    createRoot: vi.fn(() => ({ render })),
    render,
  };
});

vi.mock("react-dom/client", () => ({ createRoot: reactRoot.createRoot }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  reactRoot.createRoot.mockClear();
  reactRoot.render.mockClear();
});

describe("main", () => {
  it("fails when the root element is missing", async () => {
    const getElementById = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById });

    await expect(import("../src/main.js")).rejects.toThrow("Missing #root");
    expect(getElementById).toHaveBeenCalledWith("root");
  });

  it("renders the application into the root element", async () => {
    const root = {};
    const getElementById = vi.fn(() => root);
    vi.stubGlobal("document", { getElementById });

    await import("../src/main.js");

    expect(getElementById).toHaveBeenCalledWith("root");
    expect(reactRoot.createRoot).toHaveBeenCalledWith(root);
    expect(reactRoot.render).toHaveBeenCalledOnce();
  });
});
