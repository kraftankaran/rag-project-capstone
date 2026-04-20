// src/pages/Workspace.jsx
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import {
  Send, Loader2, Search, FileText, Plus,
  PanelLeftClose, PanelLeftOpen, X, Download,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { sendChat, clearHistory, downloadUrl, listPdfs } from "../api";
import { useDocContext } from "../context/DocContext";

// ── RankBadge — small coloured chip for BM25 / HNSW / RRF ───────────────────
function RankBadge({ label, value, color, bg, border }) {
  if (value == null) return null;
  const display = typeof value === "number" && value < 1
    ? value.toFixed(4)   // rrf_score is a small float
    : `#${value}`;       // bm25_rank / hnsw_rank are 1-based integers
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      fontSize: "0.68rem", fontWeight: 600,
      padding: "2px 7px", borderRadius: "4px",
      background: bg, border: `1px solid ${border}`, color,
    }}>
      {label} {display}
    </span>
  );
}

// ── Source card shown in the right panel ─────────────────────────────────────
function SourceCard({ source, index }) {
  const fileName = String(source.file_name ?? "").split("/").pop();
  const blobPath = source.file_name ?? "";

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      style={{
        background: "var(--card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: "0.875rem",
        display: "flex", flexDirection: "column", gap: "0.5rem",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ background: "rgba(59,130,246,0.1)", padding: "0.35rem", borderRadius: "6px", flexShrink: 0 }}>
          <FileText size={14} color="var(--primary)" />
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <p style={{
            fontWeight: 600, fontSize: "0.8rem",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "var(--foreground)",
          }}>
            {fileName}
          </p>
          <p style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", marginTop: "1px" }}>
            Page {source.page_number ?? "–"}
            {source.chunk_id != null && ` · Chunk ${source.chunk_id}`}
          </p>
        </div>
        {/* Download link */}
        {blobPath && (
          <a
            href={downloadUrl(blobPath)}
            download={fileName}
            title="Download source PDF"
            style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
          >
            <Download size={13} />
          </a>
        )}
      </div>

      {/* Ranking metadata */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        <RankBadge
          label="RRF"
          value={source.rrf_score}
          color="var(--accent)"
          bg="rgba(34,211,238,0.08)"
          border="rgba(34,211,238,0.25)"
        />
        <RankBadge
          label="BM25"
          value={source.bm25_rank}
          color="var(--primary)"
          bg="rgba(59,130,246,0.08)"
          border="rgba(59,130,246,0.2)"
        />
        <RankBadge
          label="HNSW"
          value={source.hnsw_rank}
          color="#a855f7"
          bg="rgba(168,85,247,0.08)"
          border="rgba(168,85,247,0.2)"
        />
      </div>
    </motion.div>
  );
}

// ── Workspace ─────────────────────────────────────────────────────────────────
export default function Workspace() {
  const [searchParams] = useSearchParams();
  const { selectedBlobs, toggle, clearSelection } = useDocContext();

  // Blobs from URL param (set when navigating from Documents page)
  const blobsParam = searchParams.get("blobs");
  const urlBlobs = blobsParam
    ? blobsParam.split(",").map(decodeURIComponent).filter(Boolean)
    : null;

  // Active context = URL blobs OR global context selection
  const activeBlobPaths = urlBlobs ?? Array.from(selectedBlobs);

  // All docs for the left sidebar doc-selector
  const [allDocs, setAllDocs] = useState([]);
  useEffect(() => {
    listPdfs()
      .then((d) => setAllDocs(d.filter((x) => x.blobPath.startsWith("pdfs/raw/"))))
      .catch(() => {});
  }, []);

  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Sources panel: always shows the sources of the most recent bot message
  const [latestSources, setLatestSources] = useState([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSourcesCollapsed, setIsSourcesCollapsed] = useState(false);

  // Stable session ID — regenerated on "New Chat"
  const sessionId = useRef(`session_${Date.now()}`);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── New Chat ─────────────────────────────────────────────────────────────
  // FIX: properly awaits clearHistory, resets ALL state including selection,
  // and generates a fresh sessionId that React can observe via state.
  const [sessionKey, setSessionKey] = useState(0); // forces re-render on new chat

  const handleNewChat = async () => {
    // 1. Tell backend to drop the old history
    await clearHistory(sessionId.current);
    // 2. Rotate session ID
    sessionId.current = `session_${Date.now()}`;
    // 3. Reset all local state
    setMessages([]);
    setLatestSources([]);
    setQuery("");
    setSessionKey((k) => k + 1); // triggers re-render if needed
    // 4. Clear selected documents so context resets to "all docs"
    clearSelection();
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const handleAsk = async () => {
    if (!query.trim() || loading) return;
    const text = query.trim();
    setQuery("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const data = await sendChat(text, sessionId.current, activeBlobPaths);
      const sources = data.sources ?? [];
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: data.answer ?? "No response.", sources },
      ]);
      // Update the sources panel with the latest response's sources
      setLatestSources(sources);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "bot", text: `Error: ${e.message}`, sources: [] }]);
      setLatestSources([]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); }
  };

  const contextLabel =
    activeBlobPaths.length === 0
      ? "All documents"
      : activeBlobPaths.map((p) => p.split("/").pop()).join(", ");

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left: doc selector sidebar ───────────────────────────────────── */}
      <motion.div
        animate={{ width: isSidebarCollapsed ? "50px" : "240px" }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        style={{
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--sidebar-bg)",
          display: "flex", flexDirection: "column", zIndex: 5, overflow: "hidden", flexShrink: 0,
        }}
      >
        {/* Sidebar header */}
        <div style={{
          padding: "0.875rem 0.875rem", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: isSidebarCollapsed ? "center" : "space-between",
          alignItems: "center", flexShrink: 0,
        }}>
          {!isSidebarCollapsed && (
            <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Context
            </span>
          )}
          <button
            className="btn btn-ghost"
            style={{ padding: "0.25rem" }}
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {!isSidebarCollapsed && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "0.75rem" }}>
            {/* New Chat button */}
            <button
              className="btn btn-primary"
              style={{ width: "100%", marginBottom: "0.875rem", justifyContent: "center", padding: "0.5rem" }}
              onClick={handleNewChat}
            >
              <Plus size={15} /> New Chat
            </button>

            {/* Context status */}
            <p style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", marginBottom: "0.6rem", lineHeight: 1.4 }}>
              {activeBlobPaths.length === 0
                ? "Using all documents"
                : `Using ${activeBlobPaths.length} selected document${activeBlobPaths.length > 1 ? "s" : ""}`}
            </p>

            {/* Document list */}
            <p style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
              Documents
            </p>
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1px" }}>
              {allDocs.length === 0 && (
                <p style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", padding: "0.25rem 0" }}>No documents found.</p>
              )}
              {allDocs.map((doc) => {
                const isActive = selectedBlobs.has(doc.blobPath);
                return (
                  <label
                    key={doc.blobPath}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.45rem",
                      padding: "0.45rem 0.35rem", cursor: "pointer", borderRadius: "6px",
                      backgroundColor: isActive ? "rgba(59,130,246,0.12)" : "transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseOver={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                    onMouseOut={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => toggle(doc.blobPath)}
                      style={{ accentColor: "var(--primary)", cursor: "pointer", width: "12px", height: "12px", flexShrink: 0 }}
                    />
                    <span style={{
                      fontSize: "0.77rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
                    }}>
                      {doc.name}
                    </span>
                  </label>
                );
              })}
            </div>

            {selectedBlobs.size > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.73rem", padding: "0.3rem", marginTop: "0.5rem" }}
                onClick={clearSelection}
              >
                <X size={12} /> Clear selection
              </button>
            )}
          </div>
        )}
      </motion.div>

      {/* ── Centre: Chat ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "var(--background)", minWidth: 0 }}>

        {/* Chat header */}
        <div style={{
          padding: "0.875rem 1.5rem", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.1rem" }}>AI Workspace</h2>
            <p style={{
              fontSize: "0.75rem", color: "var(--muted-foreground)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "380px",
            }}>
              Context: {contextLabel}
            </p>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: "0.78rem", padding: "0.4rem 0.8rem" }}
            onClick={handleNewChat}
            title="Start a new conversation"
          >
            <Plus size={14} /> New Chat
          </button>
        </div>

        {/* Messages */}
        <div
          className="custom-scrollbar"
          style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}
        >
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--muted-foreground)" }}>
              <div style={{ background: "var(--muted)", display: "inline-block", padding: "1rem", borderRadius: "50%", marginBottom: "1rem" }}>
                <Search size={28} color="var(--primary)" />
              </div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--foreground)", marginBottom: "0.5rem" }}>
                Ask anything
              </h3>
              <p style={{ fontSize: "0.875rem", maxWidth: "300px", lineHeight: 1.5 }}>
                {activeBlobPaths.length > 0
                  ? `Answering from ${activeBlobPaths.length} selected document${activeBlobPaths.length > 1 ? "s" : ""}.`
                  : "Answering from all available documents."}
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
            >
              {m.role === "bot" && (
                <div style={{
                  background: "linear-gradient(135deg, var(--primary), var(--accent))",
                  width: "30px", height: "30px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, marginRight: "0.75rem", marginTop: "2px",
                }}>
                  <span style={{ color: "white", fontWeight: 700, fontSize: "11px" }}>AI</span>
                </div>
              )}
              <div style={{ maxWidth: "78%" }}>
                <div style={{
                  padding: "0.875rem 1.1rem", borderRadius: "1rem",
                  backgroundColor: m.role === "user" ? "var(--primary)" : "var(--card)",
                  color: m.role === "user" ? "var(--primary-foreground)" : "var(--foreground)",
                  border: m.role === "bot" ? "1px solid var(--border)" : "none",
                  boxShadow: "var(--shadow)", fontSize: "0.9rem", lineHeight: 1.65,
                }}>
                  {m.role === "bot" ? <Markdown>{m.text}</Markdown> : m.text}
                </div>

                {/* Inline source pills below bot message */}
                {m.role === "bot" && m.sources?.length > 0 && (
                  <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                    {m.sources.map((s, si) => (
                      <span
                        key={si}
                        style={{
                          fontSize: "0.68rem", background: "var(--muted)",
                          border: "1px solid var(--border)", padding: "2px 7px",
                          borderRadius: "4px", color: "var(--muted-foreground)",
                        }}
                      >
                        {String(s.file_name ?? "").split("/").pop()} p.{s.page_number}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex" }}>
              <div style={{
                background: "linear-gradient(135deg, var(--primary), var(--accent))",
                width: "30px", height: "30px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginRight: "0.75rem",
              }}>
                <span style={{ color: "white", fontWeight: 700, fontSize: "11px" }}>AI</span>
              </div>
              <div style={{
                padding: "0.875rem 1.1rem", borderRadius: "1rem",
                backgroundColor: "var(--card)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", gap: "0.4rem",
              }}>
                {[0, 0.2, 0.4].map((delay, k) => (
                  <span key={k} style={{
                    width: "5px", height: "5px", background: "var(--primary)",
                    borderRadius: "50%", animation: `pulse 1.5s infinite ${delay}s`,
                  }} />
                ))}
              </div>
            </motion.div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input bar */}
        <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border)", backgroundColor: "var(--card)", flexShrink: 0 }}>
          <div style={{
            display: "flex", alignItems: "flex-end",
            backgroundColor: "var(--background)", border: "1px solid var(--border)",
            borderRadius: "1rem", padding: "0.4rem",
          }}>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
              rows={1}
              className="custom-scrollbar"
              style={{
                flex: 1, resize: "none", padding: "0.65rem 0.75rem",
                border: "none", backgroundColor: "transparent",
                color: "var(--foreground)", outline: "none",
                fontSize: "0.9rem", minHeight: "40px", maxHeight: "120px",
              }}
            />
            <button
              onClick={handleAsk}
              disabled={!query.trim() || loading}
              style={{
                background: query.trim() && !loading ? "var(--primary)" : "var(--muted)",
                color: query.trim() && !loading ? "var(--primary-foreground)" : "var(--muted-foreground)",
                border: "none", borderRadius: "50%",
                width: "36px", height: "36px",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: query.trim() && !loading ? "pointer" : "not-allowed",
                transition: "all 0.2s ease", margin: "2px", flexShrink: 0,
              }}
            >
              {loading
                ? <Loader2 size={16} className="animate-spin" />
                : <Send size={16} style={{ transform: "translateX(-1px)" }} />}
            </button>
          </div>
          <p style={{ textAlign: "center", fontSize: "0.68rem", color: "var(--muted-foreground)", marginTop: "0.5rem" }}>
            NeuralRAG may make mistakes. Verify important information.
          </p>
        </div>
      </div>

      {/* ── Right: Sources panel ─────────────────────────────────────────── */}
      <motion.div
        animate={{ width: isSourcesCollapsed ? "50px" : "280px" }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--sidebar-bg)",
          display: "flex", flexDirection: "column", zIndex: 5, overflow: "hidden", flexShrink: 0,
        }}
      >
        {/* Sources header */}
        <div style={{
          padding: "0.875rem", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: isSourcesCollapsed ? "center" : "space-between",
          alignItems: "center", flexShrink: 0,
        }}>
          {!isSourcesCollapsed && (
            <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <FileText size={13} /> Sources
              {latestSources.length > 0 && (
                <span style={{ background: "var(--primary)", color: "white", borderRadius: "10px", fontSize: "0.65rem", padding: "1px 6px", fontWeight: 700 }}>
                  {latestSources.length}
                </span>
              )}
            </span>
          )}
          <button
            className="btn btn-ghost"
            style={{ padding: "0.25rem" }}
            onClick={() => setIsSourcesCollapsed(!isSourcesCollapsed)}
            title={isSourcesCollapsed ? "Show sources" : "Hide sources"}
          >
            {/* Mirror the icon direction for the right panel */}
            {isSourcesCollapsed ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>

        {!isSourcesCollapsed && (
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {latestSources.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--muted-foreground)", textAlign: "center", padding: "2rem 0.5rem" }}>
                <FileText size={28} style={{ opacity: 0.2, marginBottom: "0.75rem" }} />
                <p style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
                  Sources from the most recent response will appear here.
                </p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: "0.68rem", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>
                  From latest response
                </p>
                {latestSources.map((source, i) => (
                  <SourceCard key={i} source={source} index={i} />
                ))}
              </>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
