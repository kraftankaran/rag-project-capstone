"""
Streamlit UI — Intelligent Document Explorer
Member 3 (Sneha) owns this file.
Member 4 (Karan) maintains API wiring and import paths.

Architecture:
    Streamlit (this file, port 8501)
        └── calls FastAPI (app/api/azure_api.py, port 8000)
                └── calls Member 1's services (storage, ocr, db)
                └── calls Member 2's search (vector_db, llm_chat)
"""

import sys
import os
import requests

# Make sure all app sub-packages (api, core, db, services) are importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import streamlit as st

# API base URL — reads from env so it works both locally and in Docker
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")

st.set_page_config(
    page_title="Intelligent Document Explorer",
    page_icon="📄",
    layout="wide",
)

# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("📄 Doc Explorer")
    st.markdown("---")
    st.caption(f"API: {API_BASE_URL}")

    # Health check — shows if the FastAPI backend is reachable
    try:
        r = requests.get(f"{API_BASE_URL}/pdfs", timeout=3)
        st.success("Backend connected")
    except Exception:
        st.error("Backend not reachable — is Docker running?")

# ── Main tabs ──────────────────────────────────────────────────────────────────
tab_upload, tab_search, tab_chat = st.tabs(["Upload", "Search", "Chat"])

with tab_upload:
    st.header("Upload a PDF")
    uploaded_file = st.file_uploader("Choose a PDF", type=["pdf"])

    if uploaded_file and st.button("Upload & Process", type="primary"):
        with st.spinner("Uploading to Azure and running OCR..."):
            try:
                response = requests.post(
                    f"{API_BASE_URL}/upload",
                    files={"file": (uploaded_file.name, uploaded_file.getvalue(), "application/pdf")},
                    timeout=300,
                )
                if response.status_code == 200:
                    result = response.json()
                    st.success(f"Done! Processed {result.get('pages', 0)} pages.")
                    st.json(result)
                else:
                    st.error(f"Error {response.status_code}: {response.text}")
            except Exception as e:
                st.error(f"Could not reach API: {e}")

with tab_search:
    st.header("Search Documents")
    st.info("Member 2 (Farhan) will implement vector search here.")

with tab_chat:
    st.header("Chat with Documents")
    st.info("Member 2 (Farhan) + Member 3 (Sneha) will implement RAG chat here.")
