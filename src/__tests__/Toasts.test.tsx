import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ToastProvider, useToast } from "../context/ToastContext";
import type { ToastType } from "../context/ToastContext";
import { Toasts } from "../components/Toasts";
import { act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Helper: renders Toasts inside a provider and exposes a button to inject a
// toast of a given type.
// ---------------------------------------------------------------------------
function Wrapper({
  type,
  message,
}: {
  type?: ToastType;
  message?: string;
}) {
  const { addToast } = useToast();
  return (
    <>
      {type && message && (
        <button
          data-testid="add-btn"
          onClick={() => addToast(type, message)}
        />
      )}
      <Toasts />
    </>
  );
}

function renderToasts(type?: ToastType, message?: string) {
  return render(
    <ToastProvider>
      <Wrapper type={type} message={message} />
    </ToastProvider>
  );
}

// Adds a toast and returns screen for assertions
function addAndRender(type: ToastType, message: string) {
  renderToasts(type, message);
  act(() => {
    screen.getByTestId("add-btn").click();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Toasts component", () => {
  it("returns null (renders nothing) when there are no toasts", () => {
    const { container } = renderToasts();
    expect(container.querySelector(".toast-container")).toBeNull();
  });

  it("renders a toast message when a toast is present", () => {
    addAndRender("info", "Something informative");
    expect(screen.getByText("Something informative")).toBeDefined();
  });

  it("applies toast-success CSS class for success toasts", () => {
    addAndRender("success", "Great job");
    const toast = document.querySelector(".toast-success");
    expect(toast).not.toBeNull();
  });

  it("applies toast-error CSS class for error toasts", () => {
    addAndRender("error", "Bad thing");
    const toast = document.querySelector(".toast-error");
    expect(toast).not.toBeNull();
  });

  it("applies toast-info CSS class for info toasts", () => {
    addAndRender("info", "FYI");
    const toast = document.querySelector(".toast-info");
    expect(toast).not.toBeNull();
  });

  it("applies toast-warning CSS class for warning toasts", () => {
    addAndRender("warning", "Watch out");
    const toast = document.querySelector(".toast-warning");
    expect(toast).not.toBeNull();
  });

  it("calls removeToast when the close button is clicked", () => {
    addAndRender("success", "Closeable toast");

    // Toast should be visible
    expect(screen.getByText("Closeable toast")).toBeDefined();

    // Click the close button
    const closeBtn = document.querySelector(".toast-close") as HTMLButtonElement;
    act(() => {
      fireEvent.click(closeBtn);
    });

    // Toast should be gone
    expect(screen.queryByText("Closeable toast")).toBeNull();
  });

  it("renders multiple toasts at once", () => {
    // Render a wrapper that can add multiple toasts
    function MultiWrapper() {
      const { addToast } = useToast();
      return (
        <>
          <button
            data-testid="add-one"
            onClick={() => addToast("success", "First toast")}
          />
          <button
            data-testid="add-two"
            onClick={() => addToast("error", "Second toast")}
          />
          <button
            data-testid="add-three"
            onClick={() => addToast("warning", "Third toast")}
          />
          <Toasts />
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiWrapper />
      </ToastProvider>
    );

    act(() => {
      screen.getByTestId("add-one").click();
    });
    act(() => {
      screen.getByTestId("add-two").click();
    });
    act(() => {
      screen.getByTestId("add-three").click();
    });

    expect(screen.getByText("First toast")).toBeDefined();
    expect(screen.getByText("Second toast")).toBeDefined();
    expect(screen.getByText("Third toast")).toBeDefined();

    // All three toast divs present
    const toasts = document.querySelectorAll(".toast");
    expect(toasts.length).toBe(3);
  });
});
