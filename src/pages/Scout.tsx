import { useState } from "react";
import { Search, Link, AlertCircle, RefreshCw, Globe, Clock, Trash2 } from "lucide-react";

const SCOUT_URL = "http://localhost:11436";

type Mode = "search" | "fetch";

interface CacheEntry {
  query: string;
  type: "search" | "web";
  cached_at: string;
}

// Lightweight markdown → HTML converter (no external deps)
function renderMarkdown(md: string): string {
  return md
    // Code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // Headers
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Horizontal rule
    .replace(/^---$/gm, "<hr/>")
    // Bullet lists
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // Paragraphs (double newline)
    .replace(/\n{2,}/g, "</p><p>")
    // Wrap in paragraph
    .replace(/^(?!<[h|p|l|u|h|c|p])(.+)$/gm, "$1");
}

function isMarkdown(text: string): boolean {
  return /^#{1,3} |^\s*[-*] |\*\*|```/.test(text);
}

export function Scout() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CacheEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renderMd, setRenderMd] = useState(true);

  const reset = () => { setResult(null); setError(null); setOffline(false); };

  async function runSearch(q?: string) {
    const searchQuery = q ?? query;
    if (!searchQuery.trim()) return;
    setLoading(true); reset();
    try {
      const res = await fetch(`${SCOUT_URL}/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim() }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(formatResult(data));
    } catch (e: unknown) {
      if (isNetworkError(e)) setOffline(true);
      else setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runFetch() {
    if (!url.trim()) return;
    setLoading(true); reset();
    try {
      const res = await fetch(`${SCOUT_URL}/v1/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(formatResult(data));
    } catch (e: unknown) {
      if (isNetworkError(e)) setOffline(true);
      else setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${SCOUT_URL}/v1/cache/list`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.entries ?? []);
      }
    } catch {
      setHistory([]);
    }
    setHistoryOpen(true);
  }

  async function clearCache(type: "search" | "web") {
    try {
      await fetch(`${SCOUT_URL}/v1/cache/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
        signal: AbortSignal.timeout(5000),
      });
      setHistory((h) => h.filter((e) => e.type !== type));
    } catch { /* ignore */ }
  }

  const resultIsMarkdown = result != null && isMarkdown(result);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Scout</h1>
        <span className="page-subtitle">Web intelligence</span>
      </div>

      {offline && (
        <div className="offline-banner" style={{ marginBottom: 24 }}>
          <AlertCircle size={16} />
          <span>Scout is not running. Enable it from Dashboard.</span>
        </div>
      )}

      {/* Mode toggle */}
      <section className="settings-section">
        <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center" }}>
          <button
            className={mode === "search" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "6px 14px", fontSize: 13 }}
            onClick={() => { setMode("search"); reset(); }}
          >
            <Search size={13} /> Search
          </button>
          <button
            className={mode === "fetch" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "6px 14px", fontSize: 13 }}
            onClick={() => { setMode("fetch"); reset(); }}
          >
            <Globe size={13} /> Fetch URL
          </button>
          <button
            className="btn-ghost"
            style={{ marginLeft: "auto", fontSize: 12 }}
            onClick={loadHistory}
          >
            <Clock size={13} /> History
          </button>
        </div>

        {mode === "search" ? (
          <div className="pull-row">
            <input
              className="text-input"
              placeholder="Search the web…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              disabled={loading}
            />
            <button className="btn-primary" onClick={() => runSearch()} disabled={!query.trim() || loading}>
              {loading ? <><RefreshCw size={13} className="spin" /> Searching…</> : <><Search size={13} /> Search</>}
            </button>
          </div>
        ) : (
          <div className="pull-row">
            <input
              className="text-input"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runFetch()}
              disabled={loading}
            />
            <button className="btn-primary" onClick={runFetch} disabled={!url.trim() || loading}>
              {loading ? <><RefreshCw size={13} className="spin" /> Fetching…</> : <><Link size={13} /> Fetch</>}
            </button>
          </div>
        )}
      </section>

      {/* Search history panel */}
      {historyOpen && (
        <section className="settings-section">
          <div className="section-header-row">
            <h2 className="section-title">Cache History</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-secondary btn-sm" onClick={() => clearCache("search")}>
                <Trash2 size={12} /> Clear searches
              </button>
              <button className="btn-secondary btn-sm" onClick={() => clearCache("web")}>
                <Trash2 size={12} /> Clear web
              </button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">No cached entries.</div>
          ) : (
            <div className="scout-history-list">
              {history.slice(0, 20).map((e, i) => (
                <div key={i} className="scout-history-row">
                  <span className={`scout-history-type scout-type-${e.type}`}>{e.type}</span>
                  <button
                    className="scout-history-query"
                    onClick={() => {
                      if (e.type === "search") {
                        setMode("search");
                        setQuery(e.query);
                        setHistoryOpen(false);
                        runSearch(e.query);
                      }
                    }}
                  >
                    {e.query}
                  </button>
                  <span className="scout-history-time">{e.cached_at}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Error */}
      {error && (
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <section className="settings-section">
          <div className="section-header-row">
            <h2 className="section-title">Result</h2>
            {resultIsMarkdown && (
              <button
                className="btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setRenderMd((r) => !r)}
              >
                {renderMd ? "View raw" : "Render markdown"}
              </button>
            )}
          </div>
          <div className="scout-result">
            {resultIsMarkdown && renderMd ? (
              <div
                className="scout-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
              />
            ) : (
              <pre>{result}</pre>
            )}
          </div>
        </section>
      )}

      {!result && !loading && !error && !offline && (
        <div className="empty-state-large">
          <Globe size={40} className="empty-icon" />
          <div>Search the web or fetch a URL to see results here.</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Powered by Scout · results cached locally · nothing sent to third parties except the search itself
          </div>
        </div>
      )}
    </div>
  );
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && String(e).includes("fetch")) return true;
  if (String(e).includes("ECONNREFUSED") || String(e).includes("Failed to fetch")) return true;
  return false;
}

function formatResult(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.markdown === "string") return d.markdown;
    if (typeof d.content === "string") return d.content;
    if (typeof d.text === "string") return d.text;
    if (Array.isArray(d.results)) {
      return d.results
        .map((r: unknown) => {
          if (r && typeof r === "object") {
            const item = r as Record<string, unknown>;
            const parts: string[] = [];
            if (item.title) parts.push(`## ${item.title}`);
            if (item.url) parts.push(`${item.url}`);
            if (item.snippet || item.body) parts.push(String(item.snippet ?? item.body));
            return parts.join("\n");
          }
          return String(r);
        })
        .join("\n\n---\n\n");
    }
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}
