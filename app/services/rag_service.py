# app/services/rag_service.py

import re
import textwrap
from typing import Optional, List
from dataclasses import dataclass
import numpy as np

from app.services.retrieval_service import hybrid_search, RetrievedChunk
from app.services.llm_service import HuggingFaceRouterLLMClient, ChatMessage, ANSWER_GENERATION_PROMPT
from app.services.embedding_service import generate_embedding


# ── CONFIG ─────────────────────────────────────────────────
MAX_CONTEXT_CHARS = 6000
MAX_HISTORY_TURNS = 6          # max user+assistant pairs kept
SEMANTIC_TOP_K = 6


# ── DTO ────────────────────────────────────────────────────

@dataclass
class SourceMetadata:
    """All source metadata in a single unified object."""
    id: str
    document_id: str
    file_name: str          # basename only, e.g. "policy.pdf"
    page_number: int
    chunk_id: int
    bm25_rank: Optional[int]
    hnsw_rank: Optional[int]
    rrf_score: float


@dataclass
class ChatResponse:
    answer: str
    sources: List[str]             
    metadata: dict 
    conversation_id: Optional[str] = None


# ── MEMORY (Semantic History) ───────────────────────────────

class ConversationHistory:
    """
    Per-session message store with semantic retrieval.

    Messages are stored alongside their embeddings so that at query time we
    can surface the most topically-relevant turns rather than just the most
    recent ones, reducing token usage while preserving useful context.
    """

    def __init__(self):
        self.store: dict[str, list[ChatMessage]] = {}
        self.embeddings: dict[str, list] = {}

    def append(self, cid: str, msg: ChatMessage):
        if cid not in self.store:
            self.store[cid] = []
            self.embeddings[cid] = []

        self.store[cid].append(msg)

        emb = generate_embedding(msg.content)
        self.embeddings[cid].append(emb)

        # Hard cap: keep last MAX_HISTORY_TURNS * 2 messages (user + assistant)
        max_msgs = MAX_HISTORY_TURNS * 2
        if len(self.store[cid]) > max_msgs:
            self.store[cid] = self.store[cid][-max_msgs:]
            self.embeddings[cid] = self.embeddings[cid][-max_msgs:]

    def get_recent(self, cid: str, n: int = MAX_HISTORY_TURNS) -> List[ChatMessage]:
        """Return the last *n* message pairs (most recent turns)."""
        msgs = self.store.get(cid, [])
        return msgs[-(n * 2):]

    def semantic_search(self, cid: str, query: str, top_k: int = SEMANTIC_TOP_K) -> List[ChatMessage]:
        """Return the history messages most semantically similar to *query*."""
        if cid not in self.store or not self.store[cid]:
            return []

        query_emb = generate_embedding(query)
        if query_emb is None:
            return self.get_recent(cid)

        query_vec = np.array(query_emb)
        scores = []

        for i, emb in enumerate(self.embeddings[cid]):
            if emb is None:
                continue
            emb_vec = np.array(emb)
            sim = np.dot(query_vec, emb_vec) / (
                np.linalg.norm(query_vec) * np.linalg.norm(emb_vec) + 1e-10
            )
            scores.append((sim, i))

        scores.sort(reverse=True, key=lambda x: x[0])

        selected: List[ChatMessage] = []
        used: set[int] = set()

        for _, idx in scores[:top_k]:
            if idx in used:
                continue
            selected.append(self.store[cid][idx])
            used.add(idx)
            # include neighbour for continuity
            if idx + 1 < len(self.store[cid]) and (idx + 1) not in used:
                selected.append(self.store[cid][idx + 1])
                used.add(idx + 1)

        return selected

    def clear(self, cid: str):
        self.store.pop(cid, None)
        self.embeddings.pop(cid, None)


# singleton — shared across requests
_history = ConversationHistory()


# ── CONTEXT BUILDER ────────────────────────────────────────

class ContextBuilder:

    @staticmethod
    def build(chunks: List[RetrievedChunk]) -> str:
        if not chunks:
            return "No relevant documents were found."

        parts = []
        budget = MAX_CONTEXT_CHARS

        for i, chunk in enumerate(chunks, start=1):
            file_name = _basename(chunk.file_name)
            header = f"[Source {i}] {file_name} — page {chunk.page_number}"
            body = getattr(chunk, "llm_content", chunk.content)
            entry = f"{header}\n{body}\n"

            if len(entry) > budget:
                entry = entry[:budget]

            parts.append(entry)
            budget -= len(entry)

            if budget <= 0:
                break

        return "\n---\n".join(parts)


# ── HELPERS ────────────────────────────────────────────────

def _basename(path: str) -> str:
    """Return only the filename from a full or relative path."""
    import os
    return os.path.basename(path) if path else path


def _clean_answer(text: str) -> str:
    """
    Strip literal \\n escape sequences and collapse excessive whitespace
    so the answer reads as clean plain text.
    """
    # Replace literal \n sequences (not real newlines) with a space
    text = text.replace("\\n", " ")
    # Collapse runs of real newlines into a single space
    text = re.sub(r"\n+", " ", text)
    # Collapse multiple spaces
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def _format_history(history: List[ChatMessage]) -> str:
    if not history:
        return "No prior conversation."
    lines = []
    for msg in history:
        role = "User" if msg.role == "user" else "Assistant"
        lines.append(f"{role}: {msg.content}")
    return "\n".join(lines)


def _chunk_to_source_metadata(chunk: RetrievedChunk) -> SourceMetadata:
    return SourceMetadata(
        id=chunk.id,
        document_id=chunk.document_id,
        file_name=_basename(chunk.file_name),
        page_number=chunk.page_number,
        chunk_id=chunk.chunk_id,
        bm25_rank=chunk.bm25_rank,
        hnsw_rank=chunk.hnsw_rank,
        rrf_score=chunk.rrf_score,
    )


# ── LLM CLIENT ─────────────────────────────────────────────

_llm = HuggingFaceRouterLLMClient()


# ── MAIN RAG FUNCTION ──────────────────────────────────────
def _is_bad_answer(answer: str) -> bool:
    if not answer:
        return True

    answer_lower = answer.lower()

    return (
        "do not contain sufficient information" in answer_lower
        or "not enough information" in answer_lower
        or len(answer.strip()) < 20
    )

def rag_chat(
    user_message: str,
    conversation_id: str = "default",
    top_k: int = 3,
) -> ChatResponse:
    """
    Two-step history-aware RAG pipeline:

    Step 1 — Query Rewriting
        Uses the conversation history to convert a follow-up question into a
        fully standalone question.  The rewritten query is used for retrieval
        so that the vector / BM25 search is not confused by pronouns or
        implicit references.

    Step 2 — Answer Generation
        The original user message (not the rewritten query) plus the retrieved
        context and the semantically-relevant history slice are sent to the LLM
        for answer generation.
    """

    # ── 1. Fetch recent history for query rewriting ─────────
    recent_history = _history.get_recent(conversation_id)

    # ── 2. Rewrite follow-up into a standalone query ─────────
    standalone_query = _llm.rewrite_query(recent_history, user_message)

    # ── 3. Retrieve documents using the standalone query ─────
    chunks = hybrid_search(standalone_query, top_k=top_k)

    # ── 4. Build document context ────────────────────────────
    context = ContextBuilder.build(chunks)

    # ── 5. Semantic history for answer generation ─────────────
    semantic_history = _history.semantic_search(
        conversation_id,
        standalone_query,
        top_k=SEMANTIC_TOP_K,
    )
    history_text = _format_history(semantic_history)

    # ── 6. Build system prompt ────────────────────────────────
    system_prompt = (
        ANSWER_GENERATION_PROMPT
        + f"\n\nCONVERSATION HISTORY:\n{history_text}"
        + f"\n\nDOCUMENT CONTEXT:\n{context}"
    )

    # ── 7. Generate answer ────────────────────────────────────
    raw_answer = _llm.generate(system_prompt, semantic_history, user_message)

    # ── 8. Clean formatting ───────────────────────────────────
    answer = _clean_answer(raw_answer)

    # ── 9. Persist conversation ───────────────────────────────
    _history.append(conversation_id, ChatMessage("user", user_message))
    _history.append(conversation_id, ChatMessage("assistant", answer))

    # ── 10. Build unified source metadata ─────────────────────
    source_files = list({
    _basename(c.file_name) for c in chunks
})

    metadata = {
        "chunks": [
            {
                "id": c.id,
                "document_id": c.document_id,
                "file_name": _basename(c.file_name),
                "page_number": c.page_number,
                "chunk_id": c.chunk_id,
                "bm25_rank": c.bm25_rank,
                "hnsw_rank": c.hnsw_rank,
                "rrf_score": c.rrf_score,
                "content": c.content 
            }
            for c in chunks
        ]
    }

    return ChatResponse(
        answer=answer,
        sources=source_files,
        metadata=metadata,
        conversation_id=conversation_id,
    )


def clear_history(conversation_id: str):
    _history.clear(conversation_id)
