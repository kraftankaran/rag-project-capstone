from typing import Union, List
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("intfloat/e5-large-v2")

def generate_embedding(
    text: Union[str, List[str]],
    is_query: bool = False
):
    if not text:
        return None

    # -----------------------------
    # ✅ Handle SINGLE string
    # -----------------------------
    if isinstance(text, str):
        if not text.strip():
            return None

        text = f"{'query' if is_query else 'passage'}: {text}"

        emb = model.encode(
            text,
            normalize_embeddings=True
        )

        return emb.tolist()

    # -----------------------------
    # ✅ Handle LIST of strings (BATCH)
    # -----------------------------
    elif isinstance(text, list):
        cleaned = []

        for t in text:
            if not t or not t.strip():
                continue
            cleaned.append(
                f"{'query' if is_query else 'passage'}: {t}"
            )

        if not cleaned:
            return None

        embeddings = model.encode(
            cleaned,
            normalize_embeddings=True,
            batch_size=32   # 🔥 important for speed
        )

        return embeddings.tolist()

    # -----------------------------
    # ❌ Invalid input
    # -----------------------------
    else:
        raise ValueError("Input must be string or list of strings")