import { useState } from "react";
import { Search, Link, AlertCircle, RefreshCw, Globe } from "lucide-react";

const SCOUT_URL = "http://localhost:11436";

type Mode = "search" | "fetch";

export function Scout() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setOffline(false);
    try {
      const res = await fetch(`${SCOUT_URL}/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(formatResult(data));
    } catch (e: unknown) {
      if (isNetworkError(e)) {
        setOffline(true);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const runFetch = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setOffline(false);
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
      if (isNetworkError(e)) {
        setOffline(true);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  };

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
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button
            className={mode === "search" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "6px 14px", fontSize: 13 }}
            onClick={() => { setMode("search"); setResult(null); setError(null); }}
          >
            <Search size={13} /> Search
          </button>
          <button
            className={mode === "fetch" ? "btn-primary" : "btn-secondary"}
            style={{ padding: "6px 14px", fontSize: 13 }}
            onClick={() => { setMode("fetch"); setResult(null); setError(null); }}
          >
            <Globe size={13} /> Fetch URL
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
            <button className="btn-primary" onClick={runSearch} disabled={!query.trim() || loading}>
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

      {/* Results */}
      {error && (
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <section className="settings-section">
          <h2 className="section-title">Result</h2>
          <div className="scout-result">
            <pre>{result}</pre>
          </div>
        </section>
      )}

      {!result && !loading && !error && !offline && (
        <div className="empty-state-large">
          <Globe size={40} className="empty-icon" />
          <div>Search the web or fetch a URL to see results here.</div>
        </div>
      )}
    </div>
  );
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && String(e).includes("fetch")) return true;
  if (e instanceof DOMException && e.name === "AbortError") return false;
  if (String(e).includes("ECONNREFUSED") || String(e).includes("Failed to fetch")) return true;
  return false;
}

function formatResult(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    // Try common fields from scout response
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
