import os

from app.services.storage_service import AzureStorageService
from app.services.ocr_service import run_ocr
from app.core.logging import get_logger

logger = get_logger(__name__)


def get_documents_azure(download_path: str = "data/azure"):
    storage = AzureStorageService()
    all_docs = []

    blobs = storage.list_pdfs()

    for blob in blobs:
        logger.info(f"Downloading: {blob}")

        local_file = os.path.join(download_path, blob)

        file_path = storage.download_file(blob, local_file)

        logger.info(f"Processing file: {blob}")

        docs = run_ocr(file_path, document_id=blob)
        all_docs.extend(docs)

    logger.info(f"Total pages extracted: {len(all_docs)}")

    return all_docs

def process_single_pdf(file_path: str, file_name: str, doc_id: int, file_type: str):
    logger.info(f"Processing uploaded file: {file_name}")

    docs = run_ocr(file_path, document_id=file_name, doc_id=doc_id, file_type=file_type)

    for d in docs:
        print("\n==============================")
        print(f"PDF: {d.metadata['document_id']}")
        print(f"Page: {d.metadata['page']}")
        print("\nContent:")
        print(d.page_content[:500])

        print("\nMetadata:")
        print({
            "source": d.metadata["source"],
            "page": d.metadata["page"],
            "tags": d.metadata.get("tags", [])
        })
    return docs