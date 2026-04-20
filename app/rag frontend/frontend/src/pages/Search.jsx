// src/pages/Search.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Search as SearchIcon, Filter, FileText, ChevronRight, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { listPdfs, searchContent } from "../api";

// Simple debounce hook
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("content");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [allDocs, setAllDocs] = useState([]);   // for title search

  const debouncedQuery = useDebounce(query, 380);
  const abortRef = useRef(null);

  // Pre-fetch document list for client-side title filtering
  useEffect(() => {
    listPdfs()
      .then((docs) => setAllDocs(docs.filter((d) => d.blobPath.startsWith("pdfs/raw/"))))
      .catch(() => {});
  }, []);

  // Auto-search on debounced query change
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults(null);
      return;
    }
    runSearch(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, searchType]);

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) return;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setIsSearching(true);
    setResults(null);

    try {
      if (searchType === "title") {
        // Client-side filter on the already-fetched doc list
        const filtered = allDocs.filter((d) =>
          d.name.toLowerCase().includes(q.toLowerCase())
        );
        setResults(
          filtered.map((d, i) => ({
            id: `title_${i}`,
            title: d.name,
            blobPath: d.blobPath,
            page: null,
            chunk: null,
            snippet: "Matched by filename",
            score: 1.0,
          }))
        );
      } else {
        // Semantic/hybrid content search via backend.
        // FIX: pass the abort signal so cancelled requests don't overwrite results.
        const data = await searchContent(q, 8, abortRef.current.signal);
        setResults(data);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Search failed", err);
        setResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  }, [searchType, allDocs]);

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch(query);
  };

  const clearSearch = () => {
    setQuery("");
    setResults(null);
  };

  return (
    <div
      className="page-content"
      style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Heading */}
      <div style={{ textAlign: "center", margin: "2.5rem 0 2rem" }}>
        <h1 style={{
          fontSize: "2.25rem", fontWeight: 700, marginBottom: "0.75rem",
          background: "linear-gradient(to right, var(--foreground), var(--muted-foreground))",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
        }}>
          Semantic Search
        </h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "1rem", maxWidth: "540px", margin: "0 auto" }}>
          Find relevant information across all documents using hybrid vector search. Results update as you type.
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSubmit} style={{ position: "relative", marginBottom: "1.5rem", zIndex: 10 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <SearchIcon
            style={{ position: "absolute", left: "1.25rem", color: "var(--muted-foreground)", flexShrink: 0 }}
            size={20}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchType === "title"
              ? "Search by document name…"
              : "Ask a question or search for keywords…"}
            style={{
              width: "100%",
              padding: "1.1rem 7rem 1.1rem 3.25rem",
              fontSize: "1rem",
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "2rem",
              color: "var(--foreground)",
              boxShadow: "var(--shadow-lg)",
              outline: "none",
              transition: "all 0.2s ease",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--primary)";
              e.target.style.boxShadow = "0 0 0 2px rgba(59,130,246,0.2)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--border)";
              e.target.style.boxShadow = "var(--shadow-lg)";
            }}
          />

          {/* Clear button */}
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              style={{
                position: "absolute", right: "5.5rem",
                background: "transparent", border: "none",
                color: "var(--muted-foreground)", cursor: "pointer", padding: "0.25rem"
              }}
            >
              <X size={16} />
            </button>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ position: "absolute", right: "0.5rem", borderRadius: "1.5rem", padding: "0.65rem 1.25rem" }}
            disabled={isSearching || !query.trim()}
          >
            {isSearching ? <Loader2 size={18} className="animate-spin" /> : "Search"}
          </button>
        </div>

        {/* Tabs + filter */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.875rem" }}>
          <div style={{
            display: "flex", background: "var(--card)", padding: "3px",
            borderRadius: "8px", border: "1px solid var(--border)"
          }}>
            {["content", "title"].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => { setSearchType(type); setResults(null); }}
                style={{
                  padding: "5px 14px", borderRadius: "6px", border: "none",
                  background: searchType === type ? "var(--primary)" : "transparent",
                  color: searchType === type ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  fontSize: "0.85rem", fontWeight: 500,
                  cursor: "pointer", transition: "all 0.2s ease", textTransform: "capitalize"
                }}
              >
                By {type === "content" ? "Content" : "Title"}
              </button>
            ))}
          </div>
          <span style={{ fontSize: "0.78rem", color: "var(--muted-foreground)" }}>
            {searchType === "content" ? "Hybrid BM25 + vector search" : "Client-side filename filter"}
          </span>
        </div>
      </form>

      {/* Results area */}
      <div style={{ flex: 1, paddingBottom: "2rem" }}>
        <AnimatePresence mode="wait">
          {isSearching ? (
            <motion.div
              key="searching"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 0", color: "var(--muted-foreground)" }}
            >
              <Loader2 size={36} className="animate-spin" style={{ color: "var(--primary)", marginBottom: "1rem" }} />
              <p>Searching documents…</p>
            </motion.div>
          ) : results !== null ? (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}
            >
              <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>
                {results.length === 0 ? "No results found." : `${results.length} result${results.length > 1 ? "s" : ""} found`}
              </p>

              {results.map((result, i) => (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="card"
                  style={{ cursor: "default", transition: "transform 0.15s, box-shadow 0.15s" }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "var(--shadow-lg)";
                    e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "var(--shadow)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <div className="card-content" style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
                    <div style={{ background: "rgba(59,130,246,0.1)", padding: "0.65rem", borderRadius: "10px", flexShrink: 0 }}>
                      <FileText size={22} color="var(--primary)" />
                    </div>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem", gap: "1rem" }}>
                        {/* Show only clean filename */}
                        <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--primary)", wordBreak: "break-word" }}>
                          {result.title}
                        </h3>
                        {result.score > 0 && (
                          <span style={{
                            fontSize: "0.72rem", background: "var(--muted)", padding: "3px 9px",
                            borderRadius: "10px", color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0
                          }}>
                            {result.score.toFixed(3)}
                          </span>
                        )}
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
                        {result.page != null && (
                          <span style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "1px 8px", borderRadius: "4px", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                            Page {result.page}
                          </span>
                        )}
                        {result.chunk != null && (
                          <span style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "1px 8px", borderRadius: "4px", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                            Chunk {result.chunk}
                          </span>
                        )}
                        {/* Ranking metadata badges */}
                        {result.rrf_score != null && (
                          <span style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.25)", padding: "1px 8px", borderRadius: "4px", fontSize: "0.72rem", color: "var(--accent)", fontWeight: 600 }}>
                            RRF {result.rrf_score.toFixed(4)}
                          </span>
                        )}
                        {result.bm25_rank != null && (
                          <span style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", padding: "1px 8px", borderRadius: "4px", fontSize: "0.72rem", color: "var(--primary)", fontWeight: 600 }}>
                            BM25 #{result.bm25_rank}
                          </span>
                        )}
                        {result.hnsw_rank != null && (
                          <span style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", padding: "1px 8px", borderRadius: "4px", fontSize: "0.72rem", color: "#a855f7", fontWeight: 600 }}>
                            HNSW #{result.hnsw_rank}
                          </span>
                        )}
                      </div>

                      <p style={{ color: "var(--foreground)", lineHeight: 1.65, fontSize: "0.9rem" }}>
                        {result.snippet}
                      </p>
                    </div>
                    <ChevronRight size={18} color="var(--muted-foreground)" style={{ alignSelf: "center", flexShrink: 0 }} />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 0", color: "var(--muted-foreground)", opacity: 0.5 }}
            >
              <SearchIcon size={44} style={{ marginBottom: "1rem", opacity: 0.4 }} />
              <p>Start typing to search across all processed documents</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
