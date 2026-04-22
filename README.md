# NeuralRAG — Intelligent Document Explorer

> **Production-grade Retrieval-Augmented Generation (RAG) system** for intelligent document Q&A.  
> Upload PDFs → OCR via Azure Document Intelligence → Hybrid BM25 + HNSW search → CrossEncoder reranking → Context-aware answers via LLaMA 4 (via HuggingFace Router).

[![CI](https://github.com/<your-org>/rag-project-capstone/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-org>/rag-project-capstone/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green?logo=fastapi)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-336791?logo=postgresql)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)
![Azure](https://img.shields.io/badge/Azure-Document%20Intelligence-0089D6?logo=microsoftazure)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [RAG Pipeline Deep Dive](#rag-pipeline-deep-dive)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Configure Environment Variables](#2-configure-environment-variables)
  - [3. Run with Docker Compose](#3-run-with-docker-compose)
  - [4. Verify Services Are Running](#4-verify-services-are-running)
- [Frontend Usage Guide](#frontend-usage-guide)
- [Configuration Reference](#configuration-reference)
- [CI/CD Pipeline](#cicd-pipeline)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Team](#team)

---

## Overview

NeuralRAG is an end-to-end document intelligence platform that lets users upload PDFs (and images/CSVs), automatically extracts text via Azure Document Intelligence OCR, stores dense vector embeddings alongside BM25 sparse indexes in PostgreSQL + pgvector, and exposes a conversational Q&A interface powered by a LLaMA 4 Scout 17B model (served via the HuggingFace Router API).

The system is fully containerised — a single `docker compose up` command spins up the PostgreSQL (pgvector), FastAPI backend, and React frontend. All Azure services are accessed via a Service Principal with `DefaultAzureCredential`.

---

## Key Features

| Feature | Detail |
|---|---|
| **Multi-format Ingestion** | PDF, PNG, JPG/JPEG, CSV (≤ 50 MB per file) |
| **Azure OCR** | Azure Document Intelligence `prebuilt-read` model, parallel batch processing (5 pages/batch) |
| **Sentence-aware Chunking** | NLTK sentence tokeniser, 650-character target chunks with 20% overlap |
| **Dense Embeddings** | `all-mpnet-base-v2` (768-dim) via `sentence-transformers` |
| **Hybrid Search** | BM25 (PostgreSQL `tsvector` / GIN index) + HNSW cosine ANN (`pgvector`), run in parallel via `ThreadPoolExecutor` |
| **Reciprocal Rank Fusion** | Weighted RRF (BM25 weight: 0.2, HNSW weight: 0.8, k=60) combines sparse and dense rankings |
| **CrossEncoder Reranking** | `cross-encoder/ms-marco-MiniLM-L-6-v2` reranks fused candidates before context assembly |
| **Context-window Expansion** | Adjacent-chunk retrieval adds preceding/following chunks for richer LLM context |
| **Semantic Conversation History** | Per-session embeddings of history messages; semantically relevant turns surfaced at query time |
| **Query Rewriting** | LLM rewrites follow-up questions into standalone queries before retrieval |
| **Scoped Chat** | Users can pin one or many documents; retrieval is filtered to selected files |
| **Duplicate Deduplication** | `ON CONFLICT DO NOTHING` guards on all insert paths; re-uploading a completed document is a no-op |
| **HNSW Score Filtering** | Results with cosine similarity ≤ 0.3 are dropped before returning to the client |
| **Source Citations** | Every answer includes `[Source N]` inline citations with file name and page number |
| **PDF Viewer** | In-browser PDF rendering (`react-pdf`), page-by-page navigation, single-page and full-PDF download |
| **Document Library** | Drag-and-drop upload zone, multi-document selection, workspace routing |
| **Health Endpoint** | `/health` for liveness checks and container orchestration probes |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Port 5173)                            │
│                                                                             │
│   ┌─────────────┐     ┌──────────────┐     ┌─────────────────────────┐     │
│   │  Documents  │     │    Search    │     │  Workspace (Chat + PDF) │     │
│   │   Library   │     │  (Semantic   │     │  - PDF Viewer (react-pdf│     │
│   │  - Upload   │     │   + Title)   │     │  - Multi-turn Chat      │     │
│   │  - Select   │     │  Highlight   │     │  - Source citations     │     │
│   └──────┬──────┘     └──────┬───────┘     └───────────┬─────────────┘     │
│          └──────────────────┼─────────────────────────┘                    │
│                             │  HTTP / JSON (Vite proxy → :8000)             │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────────────┐
│                        FastAPI Backend (Port 8000)                          │
│                                                                             │
│   POST /upload         → ingestion_azure_service → ocr_service             │
│   GET  /pdfs           → storage_service (Azure Blob)                       │
│   POST /search         → retrieval_service (hybrid_search)                  │
│   POST /chat           → rag_service (rag_chat)                             │
│   DELETE /chat/history → rag_service (clear_history)                        │
│   GET  /download-full  → Azure Blob streaming                               │
│   GET  /download-page  → Azure Blob streaming (single page)                 │
│   GET  /pages/:doc     → storage_service (list pages)                       │
└──────┬─────────────────┬───────────────┬────────────────┬───────────────────┘
       │                 │               │                │
       ▼                 ▼               ▼                ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────────────────┐
│   Azure     │  │   Azure      │  │ PostgreSQL  │  │  HuggingFace Router   │
│  Blob Store │  │  Document    │  │ + pgvector  │  │  (LLaMA 4 Scout 17B) │
│             │  │ Intelligence │  │             │  │                       │
│ pdfs/raw/   │  │ prebuilt-read│  │ documents   │  │ Query Rewriting       │
│ pdfs/<doc>/ │  │ OCR model    │  │ pages       │  │ Answer Generation     │
│  _page_N    │  │              │  │ ocr_results │  │                       │
└─────────────┘  └──────────────┘  │ embeddings  │  └───────────────────────┘
                                   │  (HNSW +    │
                                   │   GIN/BM25) │
                                   └─────────────┘
```

---

## RAG Pipeline Deep Dive

A user message flows through seven distinct stages before an answer is returned.

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 1 — Query Rewriting                              │
│  LLM rewrites follow-up into a standalone question      │
│  using recent conversation history (last 6 turns)       │
└───────────────────────┬─────────────────────────────────┘
                        │ standalone_query
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 2 — Parallel Dual Retrieval                      │
│                                                         │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   BM25 Search   │    │       HNSW Search           │ │
│  │ tsvector + GIN  │    │  all-mpnet-base-v2 (768-dim)│ │
│  │ websearch_to_   │    │  pgvector cosine similarity │ │
│  │ tsquery         │    │  (m=16, ef_construction=64) │ │
│  └────────┬────────┘    └──────────────┬──────────────┘ │
│  (top_k×3 candidates)   (top_k×3 candidates)            │
└──────────┬──────────────────────────────┬───────────────┘
           │     ThreadPoolExecutor       │
           ▼                              ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 3 — Reciprocal Rank Fusion (RRF)                 │
│  score = Σ weight_i / (k + rank_i)                      │
│  BM25 weight: 0.2 | HNSW weight: 0.8 | k: 60           │
│  Merged and sorted by fused RRF score                   │
└───────────────────────┬─────────────────────────────────┘
                        │ top_k×3 fused candidates
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 4 — CrossEncoder Reranking                       │
│  cross-encoder/ms-marco-MiniLM-L-6-v2                   │
│  Scores (query, chunk) pairs; drops score ≤ 0           │
└───────────────────────┬─────────────────────────────────┘
                        │ top_k reranked chunks
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 5 — Context Window Expansion                     │
│  For each top chunk: fetch chunk_id-1 and chunk_id+1    │
│  Assemble: Main content + Context before + Context after│
│  + Supporting context (from ranks top_k..top_k×2)       │
│  Budget cap: MAX_CONTEXT_CHARS = 6,000                  │
└───────────────────────┬─────────────────────────────────┘
                        │ expanded context string
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 6 — Semantic History Retrieval                   │
│  Embed query → cosine-rank stored history messages      │
│  Surface top-K semantically relevant past turns         │
│  (not just most recent) + include neighbour for context │
└───────────────────────┬─────────────────────────────────┘
                        │ semantic_history + context
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 7 — Answer Generation                            │
│  System: ANSWER_GENERATION_PROMPT + history + context   │
│  LLM: LLaMA 4 Scout 17B via HuggingFace Router         │
│  Inline [Source N] citations, prose output              │
└───────────────────────┬─────────────────────────────────┘
                        │ answer + source_references
                        ▼
                   HTTP Response
```

---

## Project Structure

```
rag-project-capstone/
├── .env.template                       # Environment variable template (copy → .env)
├── .gitignore
├── docker-compose.yml                  # Orchestrates db, api, frontend
├── docker.ignore
│
├── .github/
│   └── workflows/
│       └── ci.yml                      # GitHub Actions: syntax-check on push/PR
│
├── docker/
│   ├── Dockerfile.api                  # FastAPI container image
│   ├── Dockerfile.frontend             # Vite/React container image
│   └── init-db.sql                     # Idempotent DB init (extensions, tables, indexes)
│
└── app/
    ├── __init__.py
    ├── requirements.txt                # Python dependencies
    │
    ├── api/
    │   └── azure_api.py               # FastAPI app, all HTTP endpoints
    │
    ├── core/
    │   ├── config.py                  # Settings class; reads .env via python-dotenv
    │   └── logging.py                 # Structured logger factory
    │
    ├── db/
    │   ├── db.py                      # psycopg2 SimpleConnectionPool (min=1, max=10)
    │   └── init_db.py                 # (Legacy – superseded by docker/init-db.sql)
    │
    ├── services/
    │   ├── storage_service.py         # Azure Blob: upload, download, list raw/page PDFs
    │   ├── ocr_service.py             # PDF split → Azure Doc Intel OCR → chunk → embed
    │   ├── embedding_service.py       # all-mpnet-base-v2 sentence embedding
    │   ├── retrieval_service.py       # BM25 + HNSW search, RRF fusion, context expansion
    │   ├── re_ranker_service.py       # CrossEncoder ms-marco-MiniLM-L-6-v2 reranker
    │   ├── rag_service.py             # Full RAG pipeline, ConversationHistory, ContextBuilder
    │   ├── llm_service.py             # HuggingFace Router client; query rewrite + answer gen
    │   ├── ingestion_azure_service.py # Orchestrates OCR on uploaded file
    │   ├── ingestion_local_service.py # (Local runner variant)
    │   ├── chat_service.py            # (Auxiliary chat utilities)
    │   └── db_service.py             # CRUD helpers: documents, pages, ocr_results, embeddings
    │
    ├── runners/
    │   ├── run_azure.py               # CLI entry: download all Azure blobs + OCR
    │   └── run_local.py               # CLI entry: local file ingestion
    │
    └── rag frontend/
        └── frontend/                  # React + Vite application
            ├── index.html
            ├── vite.config.js         # Dev-server proxy: /api → :8000
            ├── package.json
            └── src/
                ├── main.jsx
                ├── App.jsx            # React Router setup
                ├── components/
                │   ├── navbar.jsx
                │   └── Sidebar.jsx
                └── pages/
                    ├── Documents.jsx  # Upload, library, multi-select, workspace routing
                    ├── Search.jsx     # Semantic/title search, keyword highlight
                    └── Workspace.jsx  # Split-pane PDF viewer + multi-turn chat
```

---

## Tech Stack

### Backend

| Layer | Technology | Version |
|---|---|---|
| Web Framework | FastAPI | ≥ 0.111 |
| ASGI Server | Uvicorn | ≥ 0.29 |
| OCR | Azure Document Intelligence (`prebuilt-read`) | ≥ 1.0.0 |
| Blob Storage | Azure Blob Storage | ≥ 12.19 |
| Auth | `DefaultAzureCredential` (Service Principal) | azure-identity ≥ 1.16 |
| Embeddings | `sentence-transformers` (`all-mpnet-base-v2`, 768-dim) | ≥ 2.7 |
| Reranker | `cross-encoder/ms-marco-MiniLM-L-6-v2` | ≥ 2.7 |
| LLM | LLaMA 4 Scout 17B via HuggingFace Router (OpenAI-compatible) | — |
| NLP / Chunking | NLTK (`sent_tokenize`) | ≥ 3.8 |
| PDF Parsing | pypdf | ≥ 4.2 |
| Database | PostgreSQL + pgvector (`ankane/pgvector` image) | HNSW m=16, ef=64 |
| DB Driver | psycopg2-binary + SimpleConnectionPool | ≥ 2.9 |
| Config | pydantic-settings + python-dotenv | ≥ 2.0 |

### Frontend

| Technology | Purpose |
|---|---|
| React 18 + Vite | SPA framework and dev/build tooling |
| React Router v6 | Client-side routing (`/`, `/search`, `/workspace`) |
| `react-pdf` | In-browser PDF rendering with page navigation |
| `react-markdown` | Renders LLM markdown output in chat bubbles |
| `framer-motion` | Animated transitions for messages and result cards |
| `lucide-react` | Icon library |

### Infrastructure

| Tool | Purpose |
|---|---|
| Docker Compose | Service orchestration (db, api, frontend) |
| GitHub Actions | CI: Python syntax validation on push / PR to `main` |
| Azure Blob Storage | Raw PDF storage (`pdfs/raw/`) and per-page PDFs (`pdfs/<doc>/`) |
| Azure Document Intelligence | OCR extraction (`prebuilt-read` model) |

---

## Database Schema

The schema is applied automatically on container startup via `docker/init-db.sql`.

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (HNSW + cosine ops)

documents          -- Tracks ingestion lifecycle per uploaded file
  document_id UUID PK   file_name   blob_path   storage_container
  file_type   status (pending|processing|completed|failed)
  page_count  created_at   updated_at

pages              -- One row per extracted page; FK → documents (CASCADE)
  id SERIAL PK   document_id   page_number   page_blob_path   local_path
  UNIQUE (document_id, page_number)

ocr_results        -- Raw OCR text per page; FK → documents (CASCADE)
  id SERIAL PK   document_id   page_number   content   tags TEXT[]   bbox JSONB
  UNIQUE (document_id, page_number)

embeddings         -- Chunked text + 768-dim vector + BM25 tsvector column
  id TEXT PK             document_id UUID FK
  file_name   file_type   page_number   chunk_id
  content TEXT            content_tsv tsvector   -- auto-updated by trigger
  embedding VECTOR(768)
  UNIQUE (document_id, page_number, chunk_id)
```

**Indexes:**

| Index | Type | Column |
|---|---|---|
| `idx_documents_status` | B-Tree | `documents(status)` |
| `idx_pages_document_id` | B-Tree | `pages(document_id)` |
| `idx_ocr_document_id` | B-Tree | `ocr_results(document_id)` |
| `idx_embeddings_document_id` | B-Tree | `embeddings(document_id)` |
| `idx_embeddings_doc_page` | B-Tree | `embeddings(document_id, page_number)` |
| `idx_embeddings_tsv` | **GIN** | `embeddings(content_tsv)` — BM25 full-text |
| `idx_embeddings_hnsw` | **HNSW** | `embeddings(embedding vector_cosine_ops)` |

A PostgreSQL trigger (`trg_update_embeddings_tsv`) automatically populates `content_tsv` on every `INSERT` or `UPDATE` to the `embeddings` table.

---

## API Reference

Base URL: `http://localhost:8000`

### `GET /health`
Liveness check. Returns `{"status": "ok"}` when the backend and Azure Storage are reachable.

---

### `POST /upload`
Upload and fully process a document.

**Request:** `multipart/form-data`
| Field | Type | Description |
|---|---|---|
| `file` | File | PDF, PNG, JPG/JPEG, or CSV (max 50 MB) |

**Response `200`:**
```json
{
  "message": "uploaded + processed",
  "document_id": "uuid-string",
  "file": "pdfs/raw/report.pdf",
  "pages": 12,
  "chunks": 48
}
```

**Response `409` (duplicate):** `{"message": "Document already processed", "document_id": "..."}`  
**Response `413`:** File exceeds 50 MB limit.  
**Response `400`:** Unsupported file type.

---

### `GET /pdfs`
Returns the list of all raw PDFs in Azure Blob Storage (`pdfs/raw/`).

**Response `200`:** `["pdfs/raw/report.pdf", "pdfs/raw/invoice.pdf"]`

---

### `POST /search`
Hybrid semantic + keyword search across all indexed documents.

**Request body:**
```json
{
  "query": "quarterly revenue breakdown",
  "top_k": 5,
  "search_type": "content"
}
```

`search_type`:
- `"content"` — hybrid BM25 + HNSW search across chunk text (default)
- `"title"` — filename match against raw PDFs in `pdfs/raw/`

**Response `200` (content search):**
```json
{
  "results": [
    {
      "id": "1_p3_c2",
      "document_id": "uuid",
      "file_name": "report.pdf",
      "page_number": 3,
      "chunk_id": 2,
      "bm25_rank": 1,
      "hnsw_rank": 2,
      "bm25_score": 0.412,
      "hnsw_score": 0.847,
      "content": "Q3 revenue reached $4.2M...",
      "rrf_score": 0.0164
    }
  ]
}
```

---

### `POST /chat`
Multi-turn, document-grounded conversational Q&A.

**Request body:**
```json
{
  "message": "What was the revenue in Q3?",
  "conversation_id": "session-abc",
  "selected_pdf_ids": ["report.pdf"]
}
```

`selected_pdf_ids`: Array of file basenames to scope retrieval. Pass `[]` to search all documents.

**Response `200`:**
```json
{
  "answer": "Q3 revenue reached $4.2M ([Source 1])...",
  "conversation_id": "session-abc",
  "sources": [{ "file_name": "report.pdf", "page_number": 3, ... }],
  "source_references": [
    { "file_name": "report.pdf", "page_number": 3 }
  ]
}
```

---

### `DELETE /chat/history/{conversation_id}`
Clears the in-memory conversation history for a given session.

---

### `GET /download-full/{file_name}`
Streams the complete raw PDF from `pdfs/raw/<file_name>`.

---

### `GET /download-page/{document_name}?page_number=N`
Streams a single-page PDF from `pdfs/<doc>/<doc>_page_N.pdf`.

---

### `GET /pages/{document_name}`
Returns the sorted list of per-page blob paths available for a document.

**Response:** `{"document": "report.pdf", "pages": ["pdfs/report/report_page_1.pdf", ...]}`

---

## Prerequisites

Before you begin, ensure you have the following:

- **Docker Desktop** ≥ 24.0 (or Docker Engine + Compose plugin)
- **Git**
- An **Azure subscription** with:
  - An **Azure Blob Storage** account and container
  - An **Azure Document Intelligence** resource (Standard tier recommended for large documents)
  - A **Service Principal** with `Storage Blob Data Contributor` and `Cognitive Services User` roles
- A **HuggingFace account** with a token that has access to the HuggingFace Router API (`meta-llama/Llama-4-Scout-17B-16E-Instruct`)

> **No Python or Node.js installation is required on your host machine.** Everything runs inside Docker containers.

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/kraftankaran/rag-project-capstone.git
cd rag-project-capstone
```

### 2. Configure Environment Variables

Copy the template and fill in your values:

```bash
cp .env.template .env
```

Open `.env` and populate every required field. See [Configuration Reference](#configuration-reference) for a full description of each variable.

```bash
# Minimum required fields:
AZURE_CLIENT_ID=...
AZURE_TENANT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_STORAGE_ACCOUNT=...
AZURE_STORAGE_CONTAINER=rag-documents
AZURE_DOC_INTEL_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
HF_TOKEN=hf_...
```

> ⚠️ **Never commit `.env` to version control.** It is listed in `.gitignore`.

### 3. Run with Docker Compose

```bash
docker compose up --build
```

This command will:
1. Pull the `ankane/pgvector` PostgreSQL image and run `docker/init-db.sql` to create all tables and indexes.
2. Build and start the FastAPI backend on port **8000**.
3. Build and start the React + Vite frontend on port **5173**.

The database health check ensures the API container does not start until PostgreSQL is ready.

To run in detached mode:

```bash
docker compose up --build -d
```

To stop and remove containers (preserving the `postgres_data` volume):

```bash
docker compose down
```

To also wipe the database volume:

```bash
docker compose down -v
```

### 4. Verify Services Are Running

| Service | URL | Expected Response |
|---|---|---|
| Frontend | http://localhost:5173 | React application loads |
| API health check | http://localhost:8000/health | `{"status": "ok"}` |
| API docs (Swagger) | http://localhost:8000/docs | Interactive API documentation |
| PostgreSQL | `localhost:5434` | Accessible via `psql` or any DB client |

---

## Frontend Usage Guide

### Document Library (`/`)

1. **Upload a document** — drag and drop a PDF onto the upload zone, or click to open the file picker. Click **Upload to Library**. The file is uploaded to Azure Blob Storage, OCR is run, and embeddings are stored. This may take 30–90 seconds depending on the document size.
2. **Browse documents** — all processed PDFs appear in the Available Documents list.
3. **Chat with one document** — click the **Chat** button on any document row to open the AI Workspace pre-loaded with that document.
4. **Chat with multiple documents** — tick the checkboxes next to several documents, then click **Chat with N Selected Documents**.

### Semantic Search (`/search`)

1. Type a natural-language query or keyword phrase into the search bar.
2. Choose **By Content** (hybrid BM25 + HNSW) or **By Title** (filename match).
3. Results are returned ranked by RRF score with matching keywords highlighted in yellow.

### AI Workspace (`/workspace`)

1. The left pane renders an in-browser PDF viewer for the selected document(s) with page-by-page navigation.
2. Use **Page** and **Full PDF** download buttons to save documents locally.
3. The right pane is a multi-turn chat interface. Ask any question; the system retrieves relevant chunks, reranks them, and returns a grounded answer with source references (file name + page number) shown as inline citation tags.
4. Press **Enter** to send a message (Shift+Enter for a newline).

---

## Configuration Reference

All variables are read from `.env` via `app/core/config.py`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | No | `postgres` | PostgreSQL username |
| `POSTGRES_PASSWORD` | No | `postgres` | PostgreSQL password |
| `POSTGRES_DB` | No | `doc_explorer` | PostgreSQL database name |
| `DATABASE_URL` | Yes | — | Full DSN. Overridden in Docker to use `db` hostname |
| `AZURE_CLIENT_ID` | Yes | — | Service Principal application (client) ID |
| `AZURE_TENANT_ID` | Yes | — | Azure Active Directory tenant ID |
| `AZURE_CLIENT_SECRET` | Yes | — | Service Principal client secret |
| `AZURE_STORAGE_ACCOUNT` | Yes | — | Storage account name (not the full URL) |
| `AZURE_STORAGE_CONTAINER` | No | `rag-documents` | Blob container name |
| `AZURE_DOC_INTEL_ENDPOINT` | Yes | — | Document Intelligence endpoint URL |
| `HF_TOKEN` | Yes | — | HuggingFace token for Router API (LLaMA 4) |
| `ENV` | No | `dev` | Environment tag (`dev` / `prod`) |
| `DEBUG` | No | `true` | Enables verbose logging |
| `API_BASE_URL` | No | `http://api:8000` | Used by the Streamlit runner (not the React frontend) |

---

## CI/CD Pipeline

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml` that triggers on every push and pull request to `main`.

**Pipeline steps:**

1. **Checkout** source code (`actions/checkout@v4`)
2. **Set up Python 3.11** (`actions/setup-python@v5`)
3. **Install dependencies** — `pip install -r app/requirements.txt`
4. **Syntax check** — `python -m compileall app` validates all `.py` files for syntax errors

To extend the pipeline (e.g., add linting or tests), edit `.github/workflows/ci.yml`.

---

## Troubleshooting

### `Backend not reachable — is Docker running?`
The API container failed to start. Check logs:
```bash
docker compose logs api
```
Common causes: missing `.env` values, Azure credentials not set, or `DATABASE_URL` misconfigured.

### `No results above HNSW threshold`
The query returned candidates but all had cosine similarity ≤ 0.3. This usually means the uploaded document's text was not extracted correctly (check OCR logs), or the query is too dissimilar from any stored content. Try a more specific query.

### Upload fails with `500`
Check that:
- `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, and `AZURE_DOC_INTEL_ENDPOINT` are set correctly in `.env`.
- The Service Principal has the `Storage Blob Data Contributor` and `Cognitive Services User` roles on the respective resources.
- The file is ≤ 50 MB and is a supported type (PDF, PNG, JPG, CSV).

### PDF viewer shows `Failed to load document preview`
The `react-pdf` viewer calls `/download/<blob_path>`. Ensure the document was uploaded successfully and the blob path is correct. Check browser network tab for the actual error from the API.

### `HF_TOKEN is not set` error in API logs
Add `HF_TOKEN=hf_...` to your `.env` file. The LLM client requires a valid HuggingFace token with access to the Router API.

### Database migration needed after code changes
The `init-db.sql` script is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). If you need to apply schema changes to an existing volume, either recreate the volume (`docker compose down -v && docker compose up --build`) or connect to the database and apply changes manually via `psql`.

### Port conflicts
| Conflict | Fix |
|---|---|
| Port 5173 already in use | Edit `ports` for `frontend` in `docker-compose.yml` |
| Port 8000 already in use | Edit `ports` for `api` in `docker-compose.yml` |
| Port 5434 already in use | Edit `ports` for `db` in `docker-compose.yml` |

---

## Contributing

1. Fork the repository and create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and ensure `python -m compileall app` passes with no errors.
3. Commit with a descriptive message: `git commit -m "feat: add streaming response support"`
4. Open a Pull Request against `main`. The CI workflow will run automatically.

Please follow these conventions:
- Python: follow PEP 8; use type hints on all new functions.
- JavaScript/JSX: prefer functional components with hooks; no class components.
- Commit messages: use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).

---

