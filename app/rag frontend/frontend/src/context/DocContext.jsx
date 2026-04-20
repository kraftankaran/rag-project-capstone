// src/context/DocContext.jsx
// ─── Global selected-document state ──────────────────────────────────────────
// Persists which PDF blobs are "selected" across all pages so that
// Documents → Workspace navigation keeps the selection intact.

import { createContext, useContext, useState, useCallback } from "react";

const DocContext = createContext(null);

export function DocProvider({ children }) {
  // Set of blobPaths (string) that are currently selected
  const [selectedBlobs, setSelectedBlobs] = useState(new Set());

  const toggle = useCallback((blobPath) => {
    setSelectedBlobs((prev) => {
      const next = new Set(prev);
      if (next.has(blobPath)) next.delete(blobPath);
      else next.add(blobPath);
      return next;
    });
  }, []);

  const selectAll = useCallback((blobPaths) => {
    setSelectedBlobs(new Set(blobPaths));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedBlobs(new Set());
  }, []);

  return (
    <DocContext.Provider value={{ selectedBlobs, toggle, selectAll, clearSelection }}>
      {children}
    </DocContext.Provider>
  );
}

export function useDocContext() {
  const ctx = useContext(DocContext);
  if (!ctx) throw new Error("useDocContext must be used inside <DocProvider>");
  return ctx;
}
