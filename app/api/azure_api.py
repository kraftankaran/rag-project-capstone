import os
import logging

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from pypdf import PdfReader

from app.db.db import Database
from app.core.config import settings
from app.core.logging import get_logger
from app.services.storage_service import AzureStorageService
from app.services.ingestion_azure_service import process_single_pdf
from app.services.retrieval_service import hybrid_search
from app.services.chat_service import chat, clear_history
from app.services.db_service import create_document, update_status, update_page_count

logger = get_logger(__name__)

app = FastAPI(title="NeuralRAG")

# CORS: allows the React frontend on port 5173 to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = "default_session"


class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5


@app.on_event("startup")
def startup():
    Database.initialize()


@app.on_event("shutdown")
def shutdown():
    Database.close_all()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    storage = AzureStorageService()
    temp_path = f"/tmp/{file.filename}"
    doc_id = None

    with open(temp_path, "wb") as f:
        f.write(await file.read())

    try:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if ext == "pdf":
            file_type = "pdf"
        elif ext in ("png", "jpg", "jpeg"):
            file_type = "image"
        elif ext == "csv":
            file_type = "csv"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: .{ext}. Accepted: pdf, png, jpg, jpeg, csv",
            )

        blob_name = storage.upload_file(temp_path, file_type=file_type)

        doc_id, already_exists = create_document(
            file_name=file.filename,
            blob_path=blob_name,
            container=settings.AZURE_STORAGE_CONTAINER,
            file_type=file_type,
        )

        if already_exists:
            return {"message": "Document already processed", "document_id": str(doc_id)}

        update_status(doc_id, "processing")
        docs = process_single_pdf(temp_path, file.filename, doc_id, file_type)

        page_count = 0
        if file_type == "pdf":
            page_count = len(PdfReader(temp_path).pages)

        update_page_count(doc_id, page_count)
        update_status(doc_id, "completed")

        return {
            "message": "uploaded + processed",
            "document_id": str(doc_id),
            "file": blob_name,
            "pages": page_count,
            "chunks": len(docs),
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.error(f"upload_pdf failed: {exc}", exc_info=True)
        if doc_id is not None:
            try:
                update_status(doc_id, "failed")
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/pdfs")
def list_pdfs():
    """
    Returns the list of original uploaded PDFs.
    Only blobs under pdfs/raw/ are returned — page-level files are excluded.
    Each entry is the full blob path (e.g. 'pdfs/raw/report.pdf').
    The frontend extracts the basename for display.
    """
    storage = AzureStorageService()
    try:
        return storage.list_raw_pdfs()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/pages/{doc_name:path}")
def list_pages(doc_name: str):
    """
    Returns the list of individual page blob paths for a given document.
    doc_name should be the base filename without extension, e.g. 'report'
    or the full filename 'report.pdf' (extension is stripped automatically).
    Page blobs live at: pdfs/<doc_name>/<doc_name>_page_N.pdf
    """
    storage = AzureStorageService()
    try:
        base = doc_name.replace(".pdf", "").replace(".PDF", "")
        pages = storage.list_pages(base)
        return {"doc_name": base, "pages": pages}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/process/{file_name:path}")
def process_pdf(file_name: str):
    storage = AzureStorageService()
    local_path = f"/tmp/{os.path.basename(file_name)}"
    storage.download_file(file_name, local_path)

    doc_id, already_exists = create_document(
        file_name=file_name,
        blob_path=file_name,
        container=settings.AZURE_STORAGE_CONTAINER,
        file_type="pdf",
    )

    if already_exists:
        return {"message": "Document already processed", "document_id": str(doc_id)}

    update_status(doc_id, "processing")
    try:
        docs = process_single_pdf(local_path, file_name, doc_id, "pdf")
        page_count = len(PdfReader(local_path).pages)
        update_page_count(doc_id, page_count)
        update_status(doc_id, "completed")
    except Exception as exc:
        update_status(doc_id, "failed")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)

    return {"message": "processed", "pages": page_count}


@app.get("/download/{blob_path:path}")
def download_pdf(blob_path: str):
    storage = AzureStorageService()
    blob_client = storage.container_client.get_blob_client(blob_path)
    stream = blob_client.download_blob()
    props = blob_client.get_blob_properties()
    return StreamingResponse(
        stream.chunks(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{blob_path.split("/")[-1]}"',
            "Content-Length": str(props.size),
        },
    )


@app.post("/search")
async def search_documents(request: SearchRequest):
    try:
        results = hybrid_search(query=request.query, top_k=request.top_k)
        return {
            "results": [
                {
                    "id": r.id,
                    "document_id": r.document_id,
                    "file_name": r.file_name,
                    "page_number": r.page_number,
                    "chunk_id": r.chunk_id,
                    "content": r.content,
                    # Ranking metadata — all three scores exposed
                    "rrf_score": r.rrf_score,
                    "bm25_rank": r.bm25_rank,
                    "hnsw_rank": r.hnsw_rank,
                }
                for r in results
            ]
        }
    except Exception as exc:
        logger.error(f"search failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/chat")
async def chat_with_docs(request: ChatRequest):
    try:
        response = chat(
            user_message=request.message,
            conversation_id=request.conversation_id,
        )
        return {
            "answer": response.answer,
            "conversation_id": response.conversation_id,
            "sources": [
                {
                    "file_name": s.file_name,
                    "page_number": s.page_number,
                    "chunk_id": s.chunk_id,
                    # Ranking metadata for frontend display
                    "bm25_rank": getattr(s, "bm25_rank", None),
                    "hnsw_rank": getattr(s, "hnsw_rank", None),
                    "rrf_score": getattr(s, "rrf_score", None),
                }
                for s in response.sources
            ],
        }
    except Exception as exc:
        logger.error(f"chat failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/chat/history/{conversation_id}")
async def reset_chat(conversation_id: str):
    clear_history(conversation_id)
    return {"message": f"History for '{conversation_id}' cleared."}
