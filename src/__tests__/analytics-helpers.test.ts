import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Copies of pure helper functions under test
// (these are not exported from their source files; testing via local copies)
// ---------------------------------------------------------------------------

// From Analytics.tsx
function fmtNum(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtPct(n?: number): string {
  if (n == null) return "—";
  return n.toFixed(1) + "%";
}

function latencyColor(ms: number): string {
  if (ms < 500) return "var(--success)";
  if (ms < 2000) return "var(--warning)";
  return "var(--danger)";
}

function agentLabel(id: string): string {
  const map: Record<string, string> = {
    claude: "Claude Code",
    "claude-code": "Claude Code",
    cursor: "Cursor",
    windsurf: "Windsurf",
    vscode: "VS Code",
    zed: "Zed",
    antigravity: "Antigravity",
  };
  return map[id.toLowerCase()] ?? id;
}

function computeCostUSD(tokensSaved: number, modelId: string): number {
  const MODELS = [
    { id: "sonnet", label: "Sonnet 4.6", inputPer1M: 3.0 },
    { id: "opus", label: "Opus 4.6", inputPer1M: 15.0 },
    { id: "haiku", label: "Haiku 4.5", inputPer1M: 0.8 },
    { id: "gpt4o", label: "GPT-4o", inputPer1M: 2.5 },
  ];
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  return (tokensSaved / 1_000_000) * model.inputPer1M;
}

function buildDateRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

interface TimelinePoint {
  date: string;
  tokens_saved: number;
  tool_calls: number;
  cost_saved_usd: number;
}

function fillTimeline(points: TimelinePoint[], days: number): TimelinePoint[] {
  const byDate = new Map(points.map((p) => [p.date, p]));
  return buildDateRange(days).map(
    (date) => byDate.get(date) ?? { date, tokens_saved: 0, tool_calls: 0, cost_saved_usd: 0 }
  );
}

// From Projects.tsx
function relativeTime(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// From Privacy.tsx
function fmtBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

// From Memory.tsx
function fmt(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayUTC(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function daysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// fmtNum
// ---------------------------------------------------------------------------
describe("fmtNum", () => {
  it("returns '0' for undefined", () => expect(fmtNum(undefined)).toBe("0"));
  it("returns '0' for 0", () => expect(fmtNum(0)).toBe("0"));
  it("returns '999' for 999", () => expect(fmtNum(999)).toBe("999"));
  it("returns '1.0K' for 1000", () => expect(fmtNum(1_000)).toBe("1.0K"));
  it("returns '1.5K' for 1500", () => expect(fmtNum(1_500)).toBe("1.5K"));
  it("returns '1.0M' for 1_000_000", () => expect(fmtNum(1_000_000)).toBe("1.0M"));
  it("returns '2.5M' for 2_500_000", () => expect(fmtNum(2_500_000)).toBe("2.5M"));
});

// ---------------------------------------------------------------------------
// fmtPct
// ---------------------------------------------------------------------------
describe("fmtPct", () => {
  it("returns '—' for undefined", () => expect(fmtPct(undefined)).toBe("—"));
  it("returns '50.5%' for 50.5", () => expect(fmtPct(50.5)).toBe("50.5%"));
  it("returns '0.0%' for 0", () => expect(fmtPct(0)).toBe("0.0%"));
  it("returns '100.0%' for 100", () => expect(fmtPct(100)).toBe("100.0%"));
});

// ---------------------------------------------------------------------------
// latencyColor
// ---------------------------------------------------------------------------
describe("latencyColor", () => {
  it("100ms → var(--success)", () => expect(latencyColor(100)).toBe("var(--success)"));
  it("499ms → var(--success)", () => expect(latencyColor(499)).toBe("var(--success)"));
  it("500ms → var(--warning)", () => expect(latencyColor(500)).toBe("var(--warning)"));
  it("1999ms → var(--warning)", () => expect(latencyColor(1999)).toBe("var(--warning)"));
  it("2000ms → var(--danger)", () => expect(latencyColor(2000)).toBe("var(--danger)"));
  it("5000ms → var(--danger)", () => expect(latencyColor(5000)).toBe("var(--danger)"));
});

// ---------------------------------------------------------------------------
// agentLabel
// ---------------------------------------------------------------------------
describe("agentLabel", () => {
  it('"claude" → "Claude Code"', () => expect(agentLabel("claude")).toBe("Claude Code"));
  it('"claude-code" → "Claude Code"', () => expect(agentLabel("claude-code")).toBe("Claude Code"));
  it('"cursor" → "Cursor"', () => expect(agentLabel("cursor")).toBe("Cursor"));
  it('"windsurf" → "Windsurf"', () => expect(agentLabel("windsurf")).toBe("Windsurf"));
  it('"vscode" → "VS Code"', () => expect(agentLabel("vscode")).toBe("VS Code"));
  it('"zed" → "Zed"', () => expect(agentLabel("zed")).toBe("Zed"));
  it('"antigravity" → "Antigravity"', () => expect(agentLabel("antigravity")).toBe("Antigravity"));
  it('"CLAUDE" → "Claude Code" (case-insensitive)', () =>
    expect(agentLabel("CLAUDE")).toBe("Claude Code"));
  it('"unknown-agent" → passthrough', () =>
    expect(agentLabel("unknown-agent")).toBe("unknown-agent"));
});

// ---------------------------------------------------------------------------
// computeCostUSD
// ---------------------------------------------------------------------------
describe("computeCostUSD", () => {
  it("1M tokens, sonnet → $3.00", () =>
    expect(computeCostUSD(1_000_000, "sonnet")).toBeCloseTo(3.0));
  it("1M tokens, opus → $15.00", () =>
    expect(computeCostUSD(1_000_000, "opus")).toBeCloseTo(15.0));
  it("1M tokens, haiku → $0.80", () =>
    expect(computeCostUSD(1_000_000, "haiku")).toBeCloseTo(0.8));
  it("1M tokens, gpt4o → $2.50", () =>
    expect(computeCostUSD(1_000_000, "gpt4o")).toBeCloseTo(2.5));
  it("500K tokens, sonnet → $1.50", () =>
    expect(computeCostUSD(500_000, "sonnet")).toBeCloseTo(1.5));
  it("1M tokens, unknown model → falls back to sonnet ($3.00)", () =>
    expect(computeCostUSD(1_000_000, "unknown")).toBeCloseTo(3.0));
});

// ---------------------------------------------------------------------------
// buildDateRange
// ---------------------------------------------------------------------------
describe("buildDateRange", () => {
  it("buildDateRange(1) returns array of length 1", () => {
    expect(buildDateRange(1)).toHaveLength(1);
  });

  it("buildDateRange(1) contains today's UTC date", () => {
    expect(buildDateRange(1)[0]).toBe(todayUTC());
  });

  it("buildDateRange(7) returns array of length 7", () => {
    expect(buildDateRange(7)).toHaveLength(7);
  });

  it("buildDateRange(30) returns array of length 30", () => {
    expect(buildDateRange(30)).toHaveLength(30);
  });

  it("first element is (days-1) days ago", () => {
    const range = buildDateRange(7);
    expect(range[0]).toBe(daysAgoUTC(6));
  });

  it("last element is today", () => {
    const range = buildDateRange(7);
    expect(range[range.length - 1]).toBe(todayUTC());
  });

  it("dates are in ascending order", () => {
    const range = buildDateRange(5);
    for (let i = 1; i < range.length; i++) {
      expect(range[i] > range[i - 1]).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// fillTimeline
// ---------------------------------------------------------------------------
describe("fillTimeline", () => {
  it("empty points with days=3 → 3 zero entries", () => {
    const result = fillTimeline([], 3);
    expect(result).toHaveLength(3);
    result.forEach((pt) => {
      expect(pt.tokens_saved).toBe(0);
      expect(pt.tool_calls).toBe(0);
      expect(pt.cost_saved_usd).toBe(0);
    });
  });

  it("existing point is preserved in output", () => {
    const today = todayUTC();
    const point: TimelinePoint = {
      date: today,
      tokens_saved: 500,
      tool_calls: 10,
      cost_saved_usd: 1.5,
    };
    const result = fillTimeline([point], 3);
    const found = result.find((p) => p.date === today);
    expect(found).toEqual(point);
  });

  it("gaps between real points are filled with zeros", () => {
    const today = todayUTC();
    const point: TimelinePoint = {
      date: today,
      tokens_saved: 100,
      tool_calls: 5,
      cost_saved_usd: 0.3,
    };
    const result = fillTimeline([point], 5);
    expect(result).toHaveLength(5);

    const gap = result.find((p) => p.date !== today);
    expect(gap).toBeDefined();
    expect(gap!.tokens_saved).toBe(0);
    expect(gap!.tool_calls).toBe(0);
    expect(gap!.cost_saved_usd).toBe(0);
  });

  it("output dates match buildDateRange", () => {
    const result = fillTimeline([], 7);
    const expected = buildDateRange(7);
    expect(result.map((p) => p.date)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// relativeTime (Projects.tsx)
// ---------------------------------------------------------------------------
describe("relativeTime", () => {
  let now: number;

  beforeEach(() => {
    now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("undefined → 'never'", () => expect(relativeTime(undefined)).toBe("never"));

  it("now → 'just now'", () => {
    expect(relativeTime(new Date(now).toISOString())).toBe("just now");
  });

  it("30 seconds ago → 'just now'", () => {
    expect(relativeTime(new Date(now - 30_000).toISOString())).toBe("just now");
  });

  it("30 minutes ago → '30m ago'", () => {
    expect(relativeTime(new Date(now - 30 * 60_000).toISOString())).toBe("30m ago");
  });

  it("2 hours ago → '2h ago'", () => {
    expect(relativeTime(new Date(now - 2 * 60 * 60_000).toISOString())).toBe("2h ago");
  });

  it("3 days ago → '3d ago'", () => {
    expect(relativeTime(new Date(now - 3 * 24 * 60 * 60_000).toISOString())).toBe("3d ago");
  });
});

// ---------------------------------------------------------------------------
// fmtBytes (Privacy.tsx)
// ---------------------------------------------------------------------------
describe("fmtBytes", () => {
  it("512 → '512 B'", () => expect(fmtBytes(512)).toBe("512 B"));
  it("1024 → '1.0 KB'", () => expect(fmtBytes(1024)).toBe("1.0 KB"));
  it("1024 * 1024 → '1.0 MB'", () => expect(fmtBytes(1024 * 1024)).toBe("1.0 MB"));
  it("1024 * 1024 * 1024 → '1.0 GB'", () =>
    expect(fmtBytes(1024 * 1024 * 1024)).toBe("1.0 GB"));
});

// ---------------------------------------------------------------------------
// fmt (Memory.tsx)
// ---------------------------------------------------------------------------
describe("fmt (Memory)", () => {
  it("undefined → '—'", () => expect(fmt(undefined)).toBe("—"));
  it("0 → '0'", () => expect(fmt(0)).toBe("0"));
  it("999 → '999'", () => expect(fmt(999)).toBe("999"));
  it("1000 → '1.0K'", () => expect(fmt(1_000)).toBe("1.0K"));
  it("1_000_000 → '1.0M'", () => expect(fmt(1_000_000)).toBe("1.0M"));
});
