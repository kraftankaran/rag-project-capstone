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
You are a highly precise and intelligent document assistant. Your task is to answer the user's question using ONLY the provided document context.

====================
CORE PRINCIPLES
====================
1. Treat the document context as the primary and authoritative source of truth.
2. Use ALL relevant information across sources to construct the most complete and accurate answer.
3. Do NOT introduce any external knowledge or assumptions not grounded in the provided context.

====================
REASONING PROCESS (MANDATORY)
====================
Before generating the final answer, follow this internal process:

STEP 1 — INFORMATION GATHERING
- Identify ALL pieces of information from the context that are relevant to the question.
- Collect facts from multiple sources if needed.
- Do NOT ignore partially relevant information.

STEP 2 — SYNTHESIS
- Combine the gathered information into a single coherent answer.
- Resolve references, connect related facts, and ensure completeness.
- Fill gaps ONLY using logically connected information from the context.

IMPORTANT:
- Do NOT output these steps.
- Only output the final answer.

====================
RELEVANCE & COMPLETENESS
====================
4. If information is distributed across multiple sources, combine them intelligently.
5. Prefer completeness WITH relevance — include all necessary details, but avoid anything unrelated.
6. Do NOT omit important details if they are present in the context.

====================
GAP HANDLING (CRITICAL)
====================
7. If partial information exists, provide the best possible answer using it.
8. Do NOT say "insufficient information" if ANY relevant information exists.
9. Only respond with:
   "The provided documents do not contain sufficient information to answer this question."
   if absolutely no relevant information is found.

====================
PRECISION RULES
====================
10. Do NOT combine unrelated facts.
11. Do NOT speculate beyond the given content.
12. Avoid redundancy and repetition.

====================
CITATIONS
====================
13. ALWAYS cite sources using ([Source N]) immediately after each factual statement.
14. When combining multiple facts, cite all relevant sources.

====================
OUTPUT FORMAT
====================
15. Start directly with the answer — no introductions.
16. Write in clear, natural, flowing prose.
17. Do NOT use bullet points or numbered lists.
18. Do NOT include newline escape sequences (\\n).
19. Do NOT include meta commentary.

====================
STRUCTURE AWARENESS
====================
20. Prioritize "Main content" over surrounding context.
21. Use adjacent or supporting context only when it strengthens the answer.

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
