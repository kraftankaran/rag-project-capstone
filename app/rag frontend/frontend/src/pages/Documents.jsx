// src/pages/Documents.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud, FileText, CheckCircle, Play, Download,
  Loader2, MessageSquare, Eye, X, ChevronLeft, ChevronRight,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { listPdfs, uploadPdf, processPdf, downloadUrl } from "../api";
import { useDocContext } from "../context/DocContext";

// ─────────────────────────────────────────────────────────────────────────────
// FIX: react-pdf v10 ships with pdfjs-dist v5.  cdnjs only hosts up to v4,
// so the old CDN workerSrc caused a version mismatch and broke rendering.
//
// The correct approach for Vite + react-pdf v10 is to import the worker file
// directly from the installed pdfjs-dist package using Vite's `?url` suffix.
// This tells Vite to bundle and serve the worker as a static asset, guaranteeing
// the worker version exactly matches the pdfjs-dist version in node_modules.
// ─────────────────────────────────────────────────────────────────────────────
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ── PDF Preview Modal ─────────────────────────────────────────────────────────
function PdfPreviewModal({ doc, onClose }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [pageWidth, setPageWidth] = useState(680);

  // Measure container width so the PDF fills the modal properly
  const containerRef = useRef(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setPageWidth(Math.min(700, Math.max(300, w - 48)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const url = downloadUrl(doc.blobPath);
  const baseName = doc.name.replace(/\.pdf$/i, "");
  // Page-level blob: pdfs/<basename>/<basename>_page_N.pdf
  const pageBlobPath = `pdfs/${baseName}/${baseName}_page_${pageNumber}.pdf`;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        backgroundColor: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)"
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", width: "min(820px, 95vw)",
          maxHeight: "92vh", display: "flex", flexDirection: "column",
          overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.7)"
        }}
      >
        {/* ── Modal header ───────────────────────────────────────────────── */}
        <div style={{
          padding: "0.875rem 1.25rem",
          borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          backgroundColor: "var(--background)", flexShrink: 0, gap: "0.75rem"
        }}>
          {/* Doc name */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", overflow: "hidden", flex: 1 }}>
            <div style={{ background: "rgba(59,130,246,0.12)", padding: "0.35rem", borderRadius: "6px", flexShrink: 0 }}>
              <FileText size={16} color="var(--primary)" />
            </div>
            <span style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.name}
            </span>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
            {/* Page navigation */}
            <div style={{
              display: "flex", alignItems: "center",
              background: "var(--muted)", padding: "0.15rem 0.3rem",
              borderRadius: "6px", gap: "0.1rem"
            }}>
              <button
                className="btn btn-ghost" style={{ padding: "0.2rem" }}
                disabled={pageNumber <= 1}
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: "0.78rem", fontFamily: "monospace", minWidth: "58px", textAlign: "center", color: "var(--foreground)" }}>
                {pageNumber} / {numPages ?? "–"}
              </span>
              <button
                className="btn btn-ghost" style={{ padding: "0.2rem" }}
                disabled={pageNumber >= (numPages ?? Infinity)}
                onClick={() => setPageNumber((p) => Math.min(numPages ?? p, p + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Download full PDF */}
            <a
              href={url}
              download={doc.name}
              className="btn btn-secondary"
              style={{ padding: "0.35rem 0.75rem", fontSize: "0.78rem", textDecoration: "none" }}
              title="Download full PDF"
            >
              <Download size={13} /> Full PDF
            </a>

            {/* Download current page — links to per-page blob in Azure */}
            <a
              href={downloadUrl(pageBlobPath)}
              download={`${baseName}_page_${pageNumber}.pdf`}
              className="btn btn-secondary"
              style={{ padding: "0.35rem 0.75rem", fontSize: "0.78rem", textDecoration: "none" }}
              title={`Download page ${pageNumber}`}
            >
              <Download size={13} /> Page {pageNumber}
            </a>

            {/* Close */}
            <button
              className="btn btn-ghost" style={{ padding: "0.3rem" }}
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── PDF canvas area ─────────────────────────────────────────────── */}
        <div
          ref={containerRef}
          className="custom-scrollbar"
          style={{
            flex: 1, overflowY: "auto",
            display: "flex", justifyContent: "center",
            padding: "1.5rem", backgroundColor: "#16181d"
          }}
        >
          {loadError ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "1rem",
              color: "var(--muted-foreground)", minHeight: "400px"
            }}>
              <AlertCircle size={36} style={{ opacity: 0.35 }} />
              <p style={{ fontSize: "0.9rem" }}>Could not load PDF preview.</p>
              <a href={url} download={doc.name} className="btn btn-primary" style={{ textDecoration: "none" }}>
                <Download size={15} /> Download instead
              </a>
            </div>
          ) : (
            <Document
              file={url}
              onLoadSuccess={({ numPages: n }) => { setNumPages(n); setLoadError(false); }}
              onLoadError={(err) => { console.error("PDF load error:", err); setLoadError(true); }}
              loading={
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "400px" }}>
                  <Loader2 size={30} className="animate-spin" color="var(--primary)" />
                </div>
              }
              options={{
                // Provide the same worker URL to the Document options so the
                // internal pdfjs DocumentInitParameters stays consistent
                workerSrc: workerUrl,
              }}
            >
              <Page
                key={pageNumber}
                pageNumber={pageNumber}
                width={pageWidth}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Documents page ───────────────────────────────────────────────────────
export default function Documents() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [processingDoc, setProcessingDoc] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { selectedBlobs, toggle, clearSelection } = useDocContext();

  const fetchDocuments = async () => {
    try {
      setLoadingDocs(true);
      const docs = await listPdfs();
      // Only show original uploads from pdfs/raw/ — exclude page-level blobs
      setDocuments(docs.filter((d) => d.blobPath.startsWith("pdfs/raw/")));
    } catch (e) {
      console.error("Failed to fetch documents", e);
      setDocuments([]);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => { fetchDocuments(); }, []);

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      await uploadPdf(file);
      setFile(null);
      fetchDocuments();
    } catch (e) {
      setUploadError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleProcess = async (doc) => {
    setProcessingDoc(doc.blobPath);
    try {
      await processPdf(doc.blobPath);
      alert(`Processing started for ${doc.name}`);
    } catch (e) {
      alert(`Process failed: ${e.message}`);
    } finally {
      setProcessingDoc(null);
    }
  };

  return (
    <>
      <div
        className="page-content custom-scrollbar"
        style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}
      >
        {/* ── Page header ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>Document Library</h1>
            <p style={{ color: "var(--muted-foreground)" }}>Upload and manage your PDFs for analysis</p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            {selectedBlobs.size > 0 && (
              <>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "0.8rem" }}
                  onClick={clearSelection}
                >
                  <X size={14} /> Clear ({selectedBlobs.size})
                </button>
                <button
                  className="btn btn-primary"
                  style={{ padding: "0.75rem 1.5rem" }}
                  onClick={() => {
                    const encoded = Array.from(selectedBlobs).map(encodeURIComponent).join(",");
                    navigate(`/workspace?blobs=${encoded}`);
                  }}
                >
                  <MessageSquare size={18} />
                  Chat with {selectedBlobs.size} {selectedBlobs.size === 1 ? "Document" : "Documents"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Upload card ───────────────────────────────────────────────── */}
        <div className="card" style={{ flexShrink: 0 }}>
          <div className="card-header">
            <h2 className="card-title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <UploadCloud size={20} color="var(--primary)" />
              Upload Document
            </h2>
          </div>
          <div className="card-content">
            <div
              onDragEnter={handleDrag} onDragLeave={handleDrag}
              onDragOver={handleDrag} onDrop={handleDrop}
              onClick={() => !file && inputRef.current?.click()}
              style={{
                border: `2px dashed ${dragActive ? "var(--primary)" : "var(--border)"}`,
                borderRadius: "var(--radius)", padding: "2.5rem 2rem",
                textAlign: "center",
                backgroundColor: dragActive ? "rgba(59,130,246,0.05)" : "var(--background)",
                transition: "all 0.2s ease",
                cursor: file ? "default" : "pointer"
              }}
            >
              <input
                ref={inputRef} type="file" accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files[0])}
              />
              {file ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                  <div style={{ background: "var(--muted)", padding: "1rem", borderRadius: "50%" }}>
                    <FileText size={32} color="var(--primary)" />
                  </div>
                  <div>
                    <p style={{ fontWeight: 600 }}>{file.name}</p>
                    <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  {uploadError && (
                    <p style={{ color: "var(--destructive)", fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <AlertCircle size={14} /> {uploadError}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "1rem" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={(e) => { e.stopPropagation(); setFile(null); setUploadError(""); }}
                      disabled={uploading}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                      disabled={uploading}
                    >
                      {uploading
                        ? <><Loader2 size={16} className="animate-spin" /> Uploading…</>
                        : <><UploadCloud size={16} /> Upload to Library</>}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                  <div style={{ background: "var(--muted)", padding: "1rem", borderRadius: "50%" }}>
                    <UploadCloud size={32} color="var(--muted-foreground)" />
                  </div>
                  <div>
                    <p style={{ fontWeight: 500, fontSize: "1.05rem", marginBottom: "0.25rem" }}>
                      Click or drag a PDF here to upload
                    </p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: "0.875rem" }}>
                      Supports PDF files
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Document list card ────────────────────────────────────────── */}
        <div className="card" style={{ flexShrink: 0, display: "flex", flexDirection: "column", maxHeight: "520px" }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 className="card-title">Available Documents</h2>
              <p className="card-description">Select documents to chat, preview, process, or download</p>
            </div>
            {documents.length > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.8rem" }}
                onClick={() => {
                  const allSelected = documents.every((d) => selectedBlobs.has(d.blobPath));
                  if (allSelected) clearSelection();
                  else documents.forEach((d) => { if (!selectedBlobs.has(d.blobPath)) toggle(d.blobPath); });
                }}
              >
                {documents.every((d) => selectedBlobs.has(d.blobPath)) ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          <div className="custom-scrollbar" style={{ overflowY: "auto", flex: 1 }}>
            {loadingDocs ? (
              <div style={{ padding: "3rem", display: "flex", justifyContent: "center" }}>
                <Loader2 size={24} className="animate-spin" color="var(--primary)" />
              </div>
            ) : documents.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--muted-foreground)" }}>
                <FileText size={32} style={{ margin: "0 auto 1rem", opacity: 0.4 }} />
                <p>No documents found. Upload a PDF to get started.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {documents.map((doc, i) => {
                  const isSelected = selectedBlobs.has(doc.blobPath);
                  return (
                    <div
                      key={doc.blobPath}
                      style={{
                        display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.9rem 1.5rem",
                        borderBottom: i < documents.length - 1 ? "1px solid var(--border)" : "none",
                        backgroundColor: isSelected ? "rgba(59,130,246,0.06)" : "transparent",
                        transition: "background-color 0.15s ease"
                      }}
                      onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "var(--muted)"; }}
                      onMouseOut={(e) => { e.currentTarget.style.backgroundColor = isSelected ? "rgba(59,130,246,0.06)" : "transparent"; }}
                    >
                      {/* Left: checkbox + icon + name */}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", overflow: "hidden", flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(doc.blobPath)}
                          style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer", accentColor: "var(--primary)", flexShrink: 0 }}
                        />
                        <div style={{ background: "rgba(59,130,246,0.1)", padding: "0.45rem", borderRadius: "8px", flexShrink: 0 }}>
                          <FileText size={18} color="var(--primary)" />
                        </div>
                        <div style={{ overflow: "hidden" }}>
                          <p style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {doc.name}
                          </p>
                          <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)", marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
                            <CheckCircle size={11} color="var(--accent)" /> Ready
                          </p>
                        </div>
                      </div>

                      {/* Right: actions */}
                      <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0, marginLeft: "1rem" }}>
                        {/* Chat */}
                        <button
                          className="btn btn-primary"
                          style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }}
                          onClick={() => navigate(`/workspace?blobs=${encodeURIComponent(doc.blobPath)}`)}
                          title="Chat with this document"
                        >
                          <MessageSquare size={14} /> Chat
                        </button>

                        {/* Preview — opens modal */}
                        <button
                          className="btn btn-secondary"
                          style={{ padding: "0.4rem 0.7rem" }}
                          onClick={() => setPreviewDoc(doc)}
                          title="Preview PDF"
                        >
                          <Eye size={15} />
                        </button>

                        {/* Process */}
                        <button
                          className="btn btn-secondary"
                          style={{ padding: "0.4rem 0.7rem" }}
                          onClick={() => handleProcess(doc)}
                          disabled={processingDoc === doc.blobPath}
                          title="Re-process document"
                        >
                          {processingDoc === doc.blobPath
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Play size={15} />}
                        </button>

                        {/* Download */}
                        <a
                          href={downloadUrl(doc.blobPath)}
                          download={doc.name}
                          className="btn btn-ghost"
                          style={{ padding: "0.4rem 0.7rem" }}
                          title="Download PDF"
                        >
                          <Download size={15} />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PDF Preview Modal */}
      <AnimatePresence>
        {previewDoc && (
          <PdfPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
