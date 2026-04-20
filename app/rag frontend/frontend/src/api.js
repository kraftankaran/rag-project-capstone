 // src/api.js
// ─── Centralised API layer ────────────────────────────────────────────────────

const BASE = ""; // empty → same origin, handled by Vite proxy

// Fetch list of PDFs.
// Backend returns string[] of blob paths e.g. ["pdfs/raw/report.pdf", …]
export async function listPdfs() {
  const res = await fetch(`${BASE}/pdfs`);
  if (!res.ok) throw new Error(`/pdfs returned ${res.status}`);
  const data = await res.json();
  return data.map((p) => ({
    blobPath: p,
    name: p.split("/").pop(),
  }));
}

// Upload a PDF file.
export async function uploadPdf(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Upload failed: ${res.status}`);
  }
  return res.json();
}

// Trigger backend processing for a blob path.
export async function processPdf(blobPath) {
  const res = await fetch(`${BASE}/process/${blobPath}`, { method: "POST" });
  if (!res.ok) throw new Error(`Process failed: ${res.status}`);
  return res.json();
}

// Return the streaming URL for a blob — used by <a href> download links.
export function downloadUrl(blobPath) {
  return `${BASE}/download/${blobPath}`;
}

// Hybrid content search.
// FIX: AbortController signal is now correctly passed into fetch so
// in-flight requests are truly cancelled when a new one starts.
// Returns the full result object including bm25_rank, hnsw_rank, rrf_score.
export async function searchContent(query, topK = 5, signal = null) {
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();

  // Normalise both array and { results: [] } shapes
  const raw = Array.isArray(data) ? data : (data.results ?? []);
  return raw.map((r, i) => ({
    id: r.id ?? i,
    title: r.file_name ? r.file_name.split("/").pop() : `Result ${i + 1}`,
    blobPath: r.file_name ?? "",
    page: r.page_number ?? null,
    chunk: r.chunk_id ?? null,
    snippet: r.content ?? "",
    // All three ranking scores now exposed
    rrf_score: r.rrf_score ?? null,
    bm25_rank: r.bm25_rank ?? null,
    hnsw_rank: r.hnsw_rank ?? null,
  }));
}

// Chat with RAG.
// selectedDocs: array of blob paths to restrict context (empty = all docs).
// Returns { answer, conversation_id, sources } where each source now includes
// bm25_rank, hnsw_rank, rrf_score from the updated /chat endpoint.
export async function sendChat(message, conversationId, selectedDocs = []) {
  let payload = message;
  if (selectedDocs.length > 0) {
    const names = selectedDocs.map((p) => p.split("/").pop()).join(", ");
    payload = `[INSTRUCTION: Restrict answers ONLY to the following documents: ${names}. Do not use other documents.]\n\n${message}`;
  }
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: payload, conversation_id: conversationId }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}

// Clear conversation history on the backend.
export async function clearHistory(conversationId) {
  try {
    await fetch(`${BASE}/chat/history/${conversationId}`, { method: "DELETE" });
  } catch {
    // Non-fatal — swallow silently.
  }
}