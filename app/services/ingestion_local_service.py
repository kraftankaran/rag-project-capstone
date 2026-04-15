import os

from app.services.ocr_service import run_ocr
from app.core.logging import get_logger

logger = get_logger(__name__)


def get_documents_local(data_path: str = "data"):
    print("PATH:", data_path)
    print("FILES FOUND:", os.listdir(data_path))
    all_docs = []

    for file in os.listdir(data_path):
        if file.lower().endswith(".pdf"):
            file_path = os.path.join(data_path, file)

            logger.info(f"Processing file: {file}")

            docs = run_ocr(file_path, document_id=file)
            all_docs.extend(docs)

    logger.info(f"Total pages extracted: {len(all_docs)}")

    return all_docs