# app/services/llm_service.py

import os
import textwrap
from typing import List
from dataclasses import dataclass
from openai import OpenAI


# ── ENV CONFIG ─────────────────────────────────────────────
HF_TOKEN = os.getenv("HF_TOKEN")

MODEL = "meta-llama/Llama-4-Scout-17B-16E-Instruct:groq"


# ── DTO ────────────────────────────────────────────────────

@dataclass
class ChatMessage:
    role: str   # "system" | "user" | "assistant"
    content: str


# ── PROMPTS ────────────────────────────────────────────────

QUERY_REWRITE_PROMPT = textwrap.dedent("""
You are a query rewriting assistant for a document QA system.

Your job: given a conversation history and a follow-up question, rewrite the
follow-up into a fully self-contained, standalone question that can be answered
without any prior context.

Rules:
- Output ONLY the rewritten question — no explanation, no preamble.
- If the follow-up is already standalone, return it unchanged.
- Preserve the original intent and all key entities from the history.
- Do NOT answer the question.
""").strip()

ANSWER_GENERATION_PROMPT = textwrap.dedent("""
You are a precise and intelligent document assistant. Answer the user's question using the provided document context.

====================
CORE RULES
====================
1. Use the document context as the primary source of truth.
2. You may make small, logical inferences to connect clearly related information, but do NOT introduce facts not supported by the context.
3. If partial information is available, provide the best possible answer using it.
4. Only respond with:
   "The provided documents do not contain sufficient information to answer this question."
   if absolutely no relevant information exists.
5. Do NOT copy or dump the context. Always synthesize.

====================
RELEVANCE & PRECISION
====================
6. Identify the most relevant portion of the context first.
7. Include additional context only if it directly supports the answer.
8. Avoid combining loosely related points.
9. Prefer precise, focused answers over broad summaries.

====================
CITATIONS
====================
10. Always cite using ([Source N]) immediately after each factual statement.

====================
OUTPUT FORMAT
====================
11. Start directly with the answer.
12. Be concise and professional.
13. Write in plain, flowing prose (no bullet points or numbered lists).
14. Do NOT include newline escape sequences (\\n).
15. Do NOT include meta commentary (e.g., "based on the documents").

====================
STRUCTURE AWARENESS
====================
16. Prioritize "Main content" over surrounding context.
17. Use adjacent or supporting context only when necessary for completeness.

====================
DOCUMENT CONTEXT
====================
""").strip()


# ── CLIENT ─────────────────────────────────────────────────

class HuggingFaceRouterLLMClient:

    def __init__(self):
        if not HF_TOKEN:
            raise ValueError("HF_TOKEN is not set")

        self.client = OpenAI(
            base_url="https://router.huggingface.co/v1",
            api_key=HF_TOKEN,
        )

    def _call(self, messages: list, temperature: float = 0.0) -> str:
        """Low-level chat completion call."""
        try:
            completion = self.client.chat.completions.create(
                model=MODEL,
                messages=messages,
                temperature=temperature,
            )
            return completion.choices[0].message.content.strip()
        except Exception as e:
            return f"LLM Error: {str(e)}"

    def rewrite_query(
        self,
        history: List[ChatMessage],
        follow_up: str,
    ) -> str:
        """
        Step 1 — Query Rewriting.

        Converts a follow-up question into a standalone question using the
        conversation history, so retrieval is context-independent.

        Returns the rewritten (standalone) question string.
        """
        # if not history:
        #     # No history → question is already standalone
        #     return follow_up

        history_text = "\n".join(
            f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
            for m in history
        )

        messages = [
            {"role": "system", "content": QUERY_REWRITE_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Conversation history:\n{history_text}\n\n"
                    f"Follow-up question: {follow_up}\n\n"
                    f"Standalone question:"
                ),
            },
        ]

        return self._call(messages, temperature=0.0)

    def generate(
        self,
        system_prompt: str,
        history: List[ChatMessage],
        user_message: str,
    ) -> str:
        """
        Step 2 — Answer Generation.

        Sends system prompt (containing doc context) + trimmed history +
        user message to the LLM and returns the raw answer.
        """
        messages = [{"role": "system", "content": system_prompt}]

        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})

        messages.append({"role": "user", "content": user_message})

        return self._call(messages, temperature=0.0)
