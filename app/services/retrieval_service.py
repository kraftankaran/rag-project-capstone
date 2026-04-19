"""
Retrieval Service — Hybrid BM25 (sparse) + HNSW (dense) search
Owner: Member 2 (Farhan)

Architecture
------------
  query
    ├─ BM25  → PostgreSQL full-text search (tsvector / GIN index)
    └─ HNSW  → pgvector HNSW cosine-similarity index
          └─ Reciprocal Rank Fusion (RRF) → unified ranked list
                └─ top-k RetrievedChunk list

No external search engines required — everything runs inside the existing
PostgreSQL + pgvector container already in docker-compose.yml.

Integration points
------------------
  - Uses app.db.db.get_connection()          (Member 1)
  - Uses app.services.embedding_service      (Member 2 — this module's sibling)
  - Called by app.services.chat_service      (Member 2)
  - Called by app.api.search_chat_api        (Member 2)
"""

import logging, re
from dataclasses import dataclass, field
from typing import Optional

from app.db.db import Database
from app.services.embedding_service import generate_embedding
from app.services.re_ranker_service import rerank

from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# ── Tuning knobs (can be overridden per call) ─────────────────────────────────
DEFAULT_TOP_K: int = 5
DEFAULT_BM25_WEIGHT: float = 0.2
DEFAULT_HNSW_WEIGHT: float = 0.8
RRF_K: int = 60


# ── Data transfer object ──────────────────────────────────────────────────────

@dataclass
class RetrievedChunk:
    """A single ranked result returned by hybrid search."""
    id: str
    document_id: str
    file_name: str
    page_number: int
    chunk_id: int
    content: str
    bm25_rank: Optional[int] = None
    hnsw_rank: Optional[int] = None
    rrf_score: float = 0.0
    metadata: dict = field(default_factory=dict)


# ── BM25 retrieval (PostgreSQL full-text search) ──────────────────────────────

def _bm25_search(query: str, top_k: int = DEFAULT_TOP_K * 2) -> list[RetrievedChunk]:
    if not query or not query.strip():
        return []

    sql = """
        SELECT
            id,
            document_id::text,
            file_name,
            page_number,
            chunk_id,
            content,
            ts_rank_cd(content_tsv, websearch_to_tsquery('english', %s)) AS bm25_score
        FROM embeddings
        ORDER BY bm25_score DESC
        LIMIT %s;
    """

    conn = Database.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (query, top_k))
            rows = cur.fetchall()
    except Exception as exc:
        logger.error(f"BM25 search failed: {exc}")
        return []
    finally:
        Database.return_connection(conn)

    results = []
    for row in rows:
        results.append(
            RetrievedChunk(
                id=row[0],
                document_id=row[1],
                file_name=row[2] or "",
                page_number=row[3] or 0,
                chunk_id=row[4] or 0,
                content=row[5] or "",
            )
        )

    return results


# ── HNSW retrieval (pgvector cosine similarity) ───────────────────────────────

def _hnsw_search(query: str, top_k: int = DEFAULT_TOP_K * 2) -> list[RetrievedChunk]:
    if not query or not query.strip():
        return []

    embedding = generate_embedding(query)
    if embedding is None:
        logger.warning("HNSW search skipped: could not generate query embedding")
        return []

    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"

    sql = """
        SELECT
            id,
            document_id::text,
            file_name,
            page_number,
            chunk_id,
            content,
            1 - (embedding <=> %s::vector) AS cosine_similarity
        FROM embeddings
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> %s::vector
        LIMIT %s;
    """

    conn = Database.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (vec_str, vec_str, top_k))
            rows = cur.fetchall()
    except Exception as exc:
        logger.error(f"HNSW search failed: {exc}")
        return []
    finally:
        Database.return_connection(conn)

    results = []
    for row in rows:
        results.append(
            RetrievedChunk(
                id=row[0],
                document_id=row[1],
                file_name=row[2] or "",
                page_number=row[3] or 0,
                chunk_id=row[4] or 0,
                content=row[5] or "",
            )
        )

    return results


# ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

def _reciprocal_rank_fusion(
    bm25_results: list[RetrievedChunk],
    hnsw_results: list[RetrievedChunk],
    bm25_weight: float = DEFAULT_BM25_WEIGHT,
    hnsw_weight: float = DEFAULT_HNSW_WEIGHT,
    rrf_k: int = RRF_K,
) -> list[RetrievedChunk]:
    merged: dict[str, RetrievedChunk] = {}

    for rank, chunk in enumerate(bm25_results, start=1):
        chunk.bm25_rank = rank
        chunk.rrf_score += bm25_weight / (rrf_k + rank)
        merged[chunk.id] = chunk

    for rank, chunk in enumerate(hnsw_results, start=1):
        chunk.hnsw_rank = rank
        rrf_contribution = hnsw_weight / (rrf_k + rank)
        if chunk.id in merged:
            merged[chunk.id].hnsw_rank = rank
            merged[chunk.id].rrf_score += rrf_contribution
        else:
            chunk.rrf_score += rrf_contribution
            merged[chunk.id] = chunk

    fused = sorted(merged.values(), key=lambda c: c.rrf_score, reverse=True)
    return fused


def normalize_query(q: str):
    q = q.lower()
    return re.sub(r'[^a-z0-9\s\.\,\%\!\?\$\:\(\)]', ' ', q)


def _get_adjacent_chunks(chunk):
    conn = Database.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, document_id::text, file_name, page_number, chunk_id, content
                FROM embeddings
                WHERE document_id = %s
                  AND page_number = %s
                  AND chunk_id BETWEEN %s AND %s
                ORDER BY chunk_id
                """,
                (
                    chunk.document_id,
                    chunk.page_number,
                    chunk.chunk_id - 1,
                    chunk.chunk_id + 1
                )
            )
            rows = cur.fetchall()

            return [
                RetrievedChunk(
                    id=r[0], document_id=r[1], file_name=r[2] or "",
                    page_number=r[3] or 0, chunk_id=r[4], content=r[5] or ""
                )
                for r in rows
            ]
    finally:
        Database.return_connection(conn)


# ── Public hybrid search entry point ─────────────────────────────────────────

def hybrid_search(
    query: str,
    top_k: int = DEFAULT_TOP_K,
    bm25_weight: float = DEFAULT_BM25_WEIGHT,
    hnsw_weight: float = DEFAULT_HNSW_WEIGHT,
) -> list[RetrievedChunk]:
    if not query or not query.strip():
        logger.warning("hybrid_search called with empty query")
        return []

    pool = top_k * 3

    raw_query = query
    normalized_query = normalize_query(query)

    with ThreadPoolExecutor(max_workers=2) as executor:
        bm25_future = executor.submit(_bm25_search, normalized_query, pool)
        hnsw_future = executor.submit(_hnsw_search, raw_query, pool)

        bm25_results = bm25_future.result()
        hnsw_results = hnsw_future.result()

    fused = _reciprocal_rank_fusion(
        bm25_results,
        hnsw_results,
        bm25_weight=bm25_weight,
        hnsw_weight=hnsw_weight,
    )

    reranked = rerank(query, fused[:top_k * 3])

    expanded = []

    top_chunks = reranked[:top_k]
    support_chunks = reranked[top_k: top_k * 2]

    for chunk in top_chunks:
        neighbors = _get_adjacent_chunks(chunk)

        prev_chunks = [c for c in neighbors if c.chunk_id < chunk.chunk_id]
        next_chunks = [c for c in neighbors if c.chunk_id > chunk.chunk_id]

        prev_text = " ".join(c.content for c in prev_chunks)
        next_text = " ".join(c.content for c in next_chunks)

        support_text = " ".join(
            c.content for c in support_chunks
            if c.id != chunk.id
        )

        sections = []
        sections.append(f"Main content:\n{chunk.content}")

        if prev_text.strip():
            sections.append(f"Context before:\n{prev_text}")

        if next_text.strip():
            sections.append(f"Context after:\n{next_text}")

        if support_text.strip():
            sections.append(f"Supporting context:\n{support_text}")

        chunk.llm_content = "\n\n".join(sections)

        expanded.append(chunk)

    final = expanded

    logger.info(
        f"hybrid_search: query='{query[:60]}' | "
        f"bm25={len(bm25_results)} hnsw={len(hnsw_results)} fused={len(fused)} returned={len(final)}"
    )
    return final
