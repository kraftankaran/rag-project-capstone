🧠 NeuralRAG — Intelligent Document Explorer
A production-grade Retrieval-Augmented Generation (RAG) system for querying PDF documents using natural language.
NeuralRAG lets you upload documents and get precise, cited answers grounded strictly in your data — no hallucinations, no external APIs required.

-----------------------------------------------

🚀 Features

📄 Upload and process PDFs with OCR

🔍 Hybrid search (BM25 + semantic vector search)

🧠 Neural re-ranking with CrossEncoder

💬 Chat with documents using a local LLM (Ollama)

📌 Page-level citations in answers

🏠 Fully local + on-prem friendly (no paid LLM APIs)

-----------------------------------------------

🏗️ Architecture
React (Vite) → FastAPI → PostgreSQL (pgvector)
                          ↓
                Azure OCR + Blob Storage
                          ↓
                      Ollama LLM
                      
-----------------------------------------------

Core Components

Frontend: React + Vite

Backend: FastAPI

Database: PostgreSQL + pgvector

OCR: Azure Document Intelligence

LLM: Ollama (llama3 / mistral)

Embeddings: all-mpnet-base-v2

Re-ranking: cross-encoder/ms-marco-MiniLM

-----------------------------------------------

⚙️ How It Works
1. Ingestion Pipeline

Upload PDF

OCR extracts text (Azure)

Text is chunked (sentence-aware)

Each chunk → embedding (768-dim)

Stored in PostgreSQL with:

Vector index (HNSW)

BM25 index



2. Query Pipeline

User asks a question

Hybrid retrieval:

BM25 (keyword)

HNSW (semantic)


Results fused via RRF

Top results re-ranked (CrossEncoder)

Context expanded (adjacent chunks)

Sent to LLM → grounded answer + citations

-----------------------------------------------

🧰 Tech Stack

Layer
Technology
Frontend
React + Vite
Backend
FastAPI
Database
PostgreSQL + pgvector
OCR
Azure Document Intelligence
Storage
Azure Blob Storage
Embeddings
all-mpnet-base-v2
Re-ranker
MiniLM CrossEncoder
LLM
Ollama (llama3, mistral)
DevOps
Docker + Docker Compose

-----------------------------------------------

📦 Setup
1. Prerequisites

Docker

Ollama installed

Azure account (Storage + Document Intelligence)


2. Environment Variables
Create .env:
AZURE_CLIENT_ID=
AZURE_TENANT_ID=
AZURE_CLIENT_SECRET=

AZURE_STORAGE_ACCOUNT=
AZURE_STORAGE_CONTAINER=rag-documents

AZURE_DOC_INTEL_ENDPOINT=

DATABASE_URL=postgresql://postgres:postgres@db:5432/doc_explorer

LLM_BACKEND=ollama
LLM_MODEL=llama3:8b
OLLAMA_BASE_URL=http://host.docker.internal:11434


3. Start Ollama
ollama pull llama3:8b
ollama serve


4. Run the App
docker compose up --build

-----------------------------------------------
🌐 Access

Service
URL
Frontend
http://localhost:5173
API
http://localhost:8000
Swagger Docs
http://localhost:8000/docs
Health Check
http://localhost:8000/health

-----------------------------------------------

🧪 API Usage
Upload PDF
POST /upload

Search
POST /search
{
  "query": "your question",
  "top_k": 5
}

Chat
POST /chat
{
  "message": "What is this document about?",
  "conversation_id": "test1"
}

-----------------------------------------------

🗄️ Database Design

documents → metadata

pages → per-page PDFs

ocr_results → extracted text

embeddings → chunks + vectors

Indexes:


HNSW → semantic search

GIN → BM25 search


⚖️ Key Design Decisions

✅ Single DB (Postgres + pgvector)

✅ Hybrid retrieval (BM25 + semantic)

✅ Local LLM (privacy + cost)

❌ In-memory chat history (not persistent)

❌ No auth (dev-focused)


⚠️ Limitations

No authentication

No document deletion

Chat history not persistent

OCR cost (Azure)

Slower responses on CPU LLM

-----------------------------------------------

🔮 Future Improvements

Streaming LLM responses

Persistent chat history (DB/Redis)

Authentication & multi-tenancy

Async OCR queue

Multilingual support

Evaluation pipeline (RAGAS)

-----------------------------------------------

📁 Project Structure
app/
 ├── api/                # FastAPI routes
 ├── services/           # OCR, retrieval, chat, embeddings
 ├── db/                 # DB connection + schema
 ├── core/               # config
frontend/
 ├── pages/              # UI pages
 ├── components/         # UI components
docker/
 ├── Dockerfile.api
 ├── init-db.sql
docker-compose.yml

-----------------------------------------------

🧠 Why NeuralRAG?
Unlike traditional search:

Traditional Search
NeuralRAG
Returns documents
Returns answers
Keyword-only
Semantic + keyword
No reasoning
LLM synthesis
No citations
Page-level citations


📜 License
MIT (or add your license)
