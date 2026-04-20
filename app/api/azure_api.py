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
from app.services.rag_service import rag_chat, clear_history
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
    search_type: Optional[str] = "content"   # ✅ ADD THIS


@app.on_event("startup")
def startup():
    
    Database.initialize()


@app.on_event("shutdown")
def shutdown():
    
    Database.close_all()


@app.get("/health")
def health():
    storage = AzureStorageService()
    return {"status": "ok"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    storage = AzureStorageService()
    temp_path = f"/tmp/{file.filename}"
    doc_id = None  # must be set before try so except can always reference it

    MAX_FILE_SIZE_MB = 50
    MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
    file_size = 0

    with open(temp_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)  # 1MB chunks
            if not chunk:
                break

            file_size += len(chunk)

            if file_size > MAX_FILE_SIZE_BYTES:
                f.close()
                if os.path.exists(temp_path):
                    os.remove(temp_path)

                raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Max allowed size is {MAX_FILE_SIZE_MB} MB"
                )

            f.write(chunk)

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
    storage = AzureStorageService()
    try:
        return storage.list_pdfs()
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


# NEW: Download the full raw PDF for a given document filename (basename only, e.g. "report.pdf")
@app.get("/download-full/{file_name:path}")
def download_full_pdf(file_name: str):
    """
    Download the complete raw PDF from pdfs/raw/<file_name>.
    Accepts the basename (e.g. 'report.pdf') or the full blob path.
    """
    storage = AzureStorageService()
    # Normalise: if caller passes just a basename, prefix with pdfs/raw/
    if not file_name.startswith("pdfs/"):
        blob_path = f"pdfs/raw/{os.path.basename(file_name)}"
    else:
        blob_path = file_name
    try:
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
    except Exception as exc:
        logger.error(f"download_full_pdf failed for '{blob_path}': {exc}", exc_info=True)
        raise HTTPException(status_code=404, detail=f"File not found: {blob_path}")


# NEW: Download a single page PDF for a given document.
# Query params: document_name (raw PDF name) and page_number (1-based int)
@app.get("/download-page/{document_name:path}")
def download_page_pdf(document_name: str, page_number: int):
    """
    Download a single page PDF from pdfs/<doc_base>_pdf/<doc_base>_page_<N>.pdf
    """
    storage = AzureStorageService()
    base_name = os.path.splitext(os.path.basename(document_name))[0].replace(" ", "_")
    blob_path = f"pdfs/{base_name}/{base_name}_page_{page_number}.pdf"
    try:
        blob_client = storage.container_client.get_blob_client(blob_path)
        stream = blob_client.download_blob()
        props = blob_client.get_blob_properties()
        return StreamingResponse(
            stream.chunks(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}_page_{page_number}.pdf"',
                "Content-Length": str(props.size),
            },
        )
    except Exception as exc:
        logger.error(f"download_page_pdf failed for '{blob_path}': {exc}", exc_info=True)
        raise HTTPException(status_code=404, detail=f"Page not found: {blob_path}")


# NEW: List all page-wise PDFs available for a document
@app.get("/pages/{document_name:path}")
def list_document_pages(document_name: str):
    """
    Returns the list of page blob paths for the given document.
    Used by the frontend to populate per-page download options.
    """
    storage = AzureStorageService()
    try:
        pages = storage.list_pages_for_document(document_name)
        return {"document": document_name, "pages": pages}
    except Exception as exc:
        logger.error(f"list_document_pages failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/search")
async def search_documents(request: SearchRequest):
    try:
        storage = AzureStorageService()

        # =========================
        # ✅ TITLE SEARCH (RAW PDFs ONLY)
        # =========================
        if request.search_type == "title":
            blobs = storage.container_client.list_blobs(name_starts_with="pdfs/")

            raw_pdfs = []

            for blob in blobs:
                path = blob.name

                # ✅ ONLY raw PDFs
                if path.startswith("pdfs/raw/") and path.endswith(".pdf"):
                    raw_pdfs.append(path)

            query_lower = request.query.lower()

            # ✅ match on filename only
            filtered = [
                pdf for pdf in raw_pdfs
                if query_lower in pdf.split("/")[-1].lower()
            ]

            return {
                "results": [
                    {
                        "id": i,
                        "file_name": pdf.split("/")[-1],  # clean name
                        "page_number": None,
                        "chunk_id": None,
                        "content": f"Document: {pdf.split('/')[-1]}",
                        "rrf_score": 1.0
                    }
                    for i, pdf in enumerate(filtered[: request.top_k])
                ]
            }

        # =========================
        # ✅ CONTENT SEARCH (UNCHANGED)
        # =========================
        results = hybrid_search(query=request.query, top_k=request.top_k)
        # print("🔍 RAW RESULTS")
        # print("="*40)

        # for r in results:
        #     print({
        #         "id": r.id,
        #         "hnsw_score": r.hnsw_score,
        #         "bm25_score": r.bm25_score
        #     })
        # ✅ FILTER HERE (only affects API response)
        filtered_results = [
            r for r in results
            if (r.hnsw_score is not None and r.hnsw_score > 0.3)
        ]
        # print("\n" + "="*40)
        # print("✅ FILTERED RESULTS (hnsw > 0.3)")
        # print("="*40)

        # for r in filtered_results:
        #     print({
        #         "id": r.id,
        #         "hnsw_score": r.hnsw_score,
        #         "bm25_score": r.bm25_score
        #     })
        if not filtered_results:
            return {
                "results": [],
                "message": "No results above HNSW threshold"
            }

        return {
            "results": [
                {
                    "id": r.id,
                    "document_id": r.document_id,
                    "file_name": r.file_name,
                    "page_number": r.page_number,
                    "chunk_id": r.chunk_id,

                    "bm25_rank": r.bm25_rank,
                    "hnsw_rank": r.hnsw_rank,

                    "bm25_score": r.bm25_score,
                    "hnsw_score": r.hnsw_score,

                    "content": r.content,
                    "rrf_score": r.rrf_score,
                }
                for r in filtered_results
            ]
        }

    except Exception as exc:
        logger.error(f"search failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/chat")
async def chat_with_docs(request: ChatRequest):
    try:
        response = rag_chat(
            user_message=request.message,
            conversation_id=request.conversation_id,
        )

        return {
            "answer": response.answer,
            "conversation_id": response.conversation_id,
            "sources": response.metadata["chunks"],  # ✅ updated
            # NEW: simplified source references with just file_name and page_number
            "source_references": [
                {
                    "file_name": chunk["file_name"],
                    "page_number": chunk["page_number"],
                }
                for chunk in response.metadata["chunks"]
            ],
        }

    except Exception as exc:
        logger.error(f"chat failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.delete("/chat/history/{conversation_id}")
async def reset_chat(conversation_id: str):
    storage = AzureStorageService()
    clear_history(conversation_id)
    return {"message": f"History for '{conversation_id}' cleared."}
