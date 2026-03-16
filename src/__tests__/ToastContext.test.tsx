import { render, screen, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToastProvider, useToast } from "../context/ToastContext";

// ---------------------------------------------------------------------------
// Helper: renders a component that exposes the toast context via data-testid
// ---------------------------------------------------------------------------
function ToastInspector() {
  const { toasts, addToast, removeToast } = useToast();
  return (
    <div>
      <div data-testid="toast-count">{toasts.length}</div>
      <ul>
        {toasts.map((t) => (
          <li key={t.id} data-testid={`toast-${t.id}`}>
            {t.type}:{t.message}
          </li>
        ))}
      </ul>
      <button
        data-testid="add-success"
        onClick={() => addToast("success", "Hello success")}
      />
      <button
        data-testid="add-error"
        onClick={() => addToast("error", "Hello error")}
      />
      <button
        data-testid="add-short"
        onClick={() => addToast("info", "Short lived", 1000)}
      />
      <button
        data-testid="remove-first"
        onClick={() => toasts[0] && removeToast(toasts[0].id)}
      />
    </div>
  );
}

function ThrowingComponent() {
  useToast(); // called outside provider — must throw
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ToastContext", () => {
  describe("useToast outside provider", () => {
    it("throws when used outside ToastProvider", () => {
      // Suppress the React error boundary noise in test output
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => render(<ThrowingComponent />)).toThrow(
        "useToast must be inside ToastProvider"
      );
      spy.mockRestore();
    });
  });

  describe("addToast", () => {
    it("adds a toast with the correct type and message", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      act(() => {
        screen.getByTestId("add-success").click();
      });

      expect(screen.getByTestId("toast-count").textContent).toBe("1");
      expect(screen.getByTestId("toast-1").textContent).toBe(
        "success:Hello success"
      );
    });

    it("assigns sequential ids starting at 1", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      act(() => {
        screen.getByTestId("add-success").click();
      });
      act(() => {
        screen.getByTestId("add-error").click();
      });
      act(() => {
        screen.getByTestId("add-success").click();
      });

      expect(screen.getByTestId("toast-1")).toBeDefined();
      expect(screen.getByTestId("toast-2")).toBeDefined();
      expect(screen.getByTestId("toast-3")).toBeDefined();
      expect(screen.getByTestId("toast-count").textContent).toBe("3");
    });

    it("keeps at most 5 toasts (drops oldest when limit exceeded)", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      // Add 6 toasts — the first one should be dropped
      for (let i = 0; i < 6; i++) {
        act(() => {
          screen.getByTestId("add-success").click();
        });
      }

      expect(screen.getByTestId("toast-count").textContent).toBe("5");
      // id "1" (the oldest) should no longer be in the DOM
      expect(screen.queryByTestId("toast-1")).toBeNull();
      // id "6" (the newest) must be present
      expect(screen.getByTestId("toast-6")).toBeDefined();
    });

    it("multiple toasts can coexist", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      act(() => {
        screen.getByTestId("add-success").click();
      });
      act(() => {
        screen.getByTestId("add-error").click();
      });

      expect(screen.getByTestId("toast-count").textContent).toBe("2");
      expect(screen.getByTestId("toast-1").textContent).toContain("success");
      expect(screen.getByTestId("toast-2").textContent).toContain("error");
    });
  });

  describe("removeToast", () => {
    it("removes a toast by id", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      act(() => {
        screen.getByTestId("add-success").click();
      });
      expect(screen.getByTestId("toast-count").textContent).toBe("1");

      act(() => {
        screen.getByTestId("remove-first").click();
      });
      expect(screen.getByTestId("toast-count").textContent).toBe("0");
    });
  });

  describe("auto-remove after durationMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-removes a toast after its durationMs elapses", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      act(() => {
        screen.getByTestId("add-short").click(); // durationMs = 1000
      });
      expect(screen.getByTestId("toast-count").textContent).toBe("1");

      // Advance time past the duration and flush React state updates in one act
      act(() => {
        vi.advanceTimersByTime(1001);
      });

      expect(screen.getByTestId("toast-count").textContent).toBe("0");
    });

    it("does NOT auto-remove before durationMs elapses", () => {
      render(
        <ToastProvider>
          <ToastInspector />
        </ToastProvider>
      );

      act(() => {
        screen.getByTestId("add-short").click(); // durationMs = 1000
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.getByTestId("toast-count").textContent).toBe("1");
    });
  });
});
