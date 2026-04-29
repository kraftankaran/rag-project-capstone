import os
import re
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# NEW: helper used by list_pages_for_document to sort pages in numeric order
def _extract_page_number(blob_name: str) -> int:
    match = re.search(r"_page_(\d+)", blob_name)
    return int(match.group(1)) if match else 0


class AzureStorageService:
    def __init__(self):
        self.client = BlobServiceClient(
            account_url=f"https://{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net",
            credential=DefaultAzureCredential(),
        )
        self.container_client = self.client.get_container_client(
            settings.AZURE_STORAGE_CONTAINER
        )

    def list_pdfs(self):
        # MODIFIED: return only files inside pdfs/raw/ – exclude page-level split folders (*_pdf/)
        blobs = [
            blob.name
            for blob in self.container_client.list_blobs(name_starts_with="pdfs/raw/")
            if blob.name.endswith(".pdf")
        ]
        logger.info(f"Found {len(blobs)} raw PDFs in Azure (pdfs/raw/)")
        return blobs

# MODIFIED
    def list_pages_for_document(self, document_name: str):
        base_name = os.path.splitext(os.path.basename(document_name))[0]

        # FIX: remove _pdf
        prefix = f"pdfs/{base_name}/"

        pages = [
            blob.name
            for blob in self.container_client.list_blobs(name_starts_with=prefix)
            if blob.name.endswith(".pdf")
        ]

        # Sort by page number
        pages.sort(key=lambda p: _extract_page_number(p))

        logger.info(f"Found {len(pages)} page PDFs for '{document_name}' under '{prefix}'")
        return pages

    def download_file(self, blob_path: str, local_path: str):
        dir_ = os.path.dirname(local_path)
        if dir_:
            os.makedirs(dir_, exist_ok=True)
        blob = self.container_client.get_blob_client(blob_path)
        with open(local_path, "wb") as f:
            f.write(blob.download_blob().readall())
        logger.info(f"Downloaded {blob_path} → {local_path}")
        return local_path

    def upload_file(self, local_path: str, file_type: str, blob_path: str = None):
        if not blob_path:
            file_name = os.path.basename(local_path)
            blob_path = f"{file_type}s/raw/{file_name}"
        blob = self.container_client.get_blob_client(blob_path)
        with open(local_path, "rb") as data:
            blob.upload_blob(data, overwrite=True)
        logger.info(f"Uploaded {local_path} → {blob_path}")
        return blob_path

    def upload_page_pdf(self, local_path: str, document_name: str, page_num: int, file_type: str):
        base_name = os.path.splitext(os.path.basename(document_name))[0]
        blob_path = f"{file_type}s/{base_name}/{base_name}_page_{page_num}.pdf"
        blob = self.container_client.get_blob_client(blob_path)
        with open(local_path, "rb") as data:
            blob.upload_blob(data, overwrite=True)
        logger.info(f"Uploaded page → {blob_path}")
        return blob_path
