import logging
from sentence_transformers import CrossEncoder

logger = logging.getLogger(__name__)

_reranker = None


def _get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        logger.info("Loading CrossEncoder reranker model...")
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        logger.info("CrossEncoder reranker loaded")
    return _reranker


def rerank(query: str, chunks: list) -> list:
    if not chunks:
        return chunks
    try:
        model = _get_reranker()
        pairs = [(query, c.content) for c in chunks]
        scores = model.predict(pairs)

        for c, score in zip(chunks, scores):
            c.rerank_score = float(score)

        filtered = [c for c in chunks if c.rerank_score > 0]
        if not filtered:
            filtered = chunks

        return sorted(filtered, key=lambda x: x.rerank_score, reverse=True)
    except Exception as exc:
        logger.error(f"rerank failed: {exc}", exc_info=True)
        return chunks
