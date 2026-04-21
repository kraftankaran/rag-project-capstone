from sentence_transformers import SentenceTransformer

model = SentenceTransformer("intfloat/e5-large-v2")

def generate_embedding(text: str, is_query: bool = False):
    if not text or not text.strip():
        return None

    # 🔹 REQUIRED for E5
    if is_query:
        text = f"query: {text}"
    else:
        text = f"passage: {text}"

    emb = model.encode(
        text,
        normalize_embeddings=True
    )

    return emb.tolist()