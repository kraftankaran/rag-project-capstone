-- ─────────────────────────────────────────────────────────────────────────────
-- Intelligent Document Explorer — Database Initialisation
-- Owner: Karan (Member 4 — DevOps)
--
-- Tables match Member 1's (Rehman's) app/db/init_db.py exactly:
--   documents, pages, ocr_results
-- Plus pgvector extension for Member 2's (Farhan's) embeddings
-- ─────────────────────────────────────────────────────────────────────────────

-- Required for UUID generation (used by Member 1's documents table)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Required for vector embeddings (used by Member 2's search)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── documents ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    document_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name         TEXT NOT NULL,
    blob_path         TEXT NOT NULL,
    storage_container TEXT NOT NULL,
    file_type         TEXT,
    uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
    status            TEXT NOT NULL CHECK (
                          status IN ('pending', 'processing', 'completed', 'failed')
                      ) DEFAULT 'pending',
    page_count        INT DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── pages ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pages (
    id              SERIAL PRIMARY KEY,
    document_id     UUID NOT NULL,
    page_number     INT,
    page_blob_path  TEXT,
    local_path      TEXT,

    CONSTRAINT fk_pages_document
        FOREIGN KEY (document_id)
        REFERENCES documents(document_id)
        ON DELETE CASCADE
);

-- ── ocr_results ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_results (
    id          SERIAL PRIMARY KEY,
    document_id UUID NOT NULL,
    page_number INT,
    content     TEXT,
    tags        TEXT[],
    bbox        JSONB,
    line_index  INT,
    created_at  TIMESTAMP DEFAULT NOW(),

    CONSTRAINT fk_ocr_document
        FOREIGN KEY (document_id)
        REFERENCES documents(document_id)
        ON DELETE CASCADE
);

-- ── chunks (for Member 2 — Farhan's vector search) ───────────────────────────
CREATE TABLE IF NOT EXISTS chunks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id       UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    page_number       INTEGER NOT NULL,
    chunk_index       INTEGER NOT NULL,
    text              TEXT NOT NULL,
    bounding_box_json JSONB,
    embedding         vector(1536),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_status
    ON documents (status);

CREATE INDEX IF NOT EXISTS idx_pages_document_id
    ON pages (document_id);

CREATE INDEX IF NOT EXISTS idx_ocr_document_id
    ON ocr_results (document_id);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id
    ON chunks (document_id);
