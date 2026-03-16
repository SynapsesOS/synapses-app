import { vi } from "vitest";

export const listen = vi.fn().mockImplementation(() => Promise.resolve(() => {}));
export const emit = vi.fn();
