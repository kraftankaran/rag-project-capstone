import os
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


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
        """
        Original method — returns ALL PDF blob paths.
        Kept for backward compatibility with any internal callers.
        """
        blobs = [
            blob.name
            for blob in self.container_client.list_blobs()
            if blob.name.endswith(".pdf")
        ]
        logger.info(f"Found {len(blobs)} PDFs in Azure")
        return blobs

    def list_raw_pdfs(self):
        """
        Returns only the original uploaded PDFs under pdfs/raw/.
        Used by the /pdfs API endpoint so the frontend never sees
        page-level or intermediate blobs.
        """
        blobs = [
            blob.name
            for blob in self.container_client.list_blobs(name_starts_with="pdfs/raw/")
            if blob.name.endswith(".pdf")
        ]
        logger.info(f"Found {len(blobs)} raw PDFs in Azure")
        return blobs

    def list_pages(self, base_doc_name: str):
        """
        Returns page blob paths for a given document.
        Azure structure: pdfs/<base_doc_name>/<base_doc_name>_page_N.pdf
        """
        prefix = f"pdfs/{base_doc_name}/"
        blobs = [
            blob.name
            for blob in self.container_client.list_blobs(name_starts_with=prefix)
            if blob.name.endswith(".pdf")
        ]
        blobs.sort()   # ensure page order
        logger.info(f"Found {len(blobs)} pages for '{base_doc_name}'")
        return blobs

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
            file_name = os.path.basename(local_path).replace(" ", "_")
            blob_path = f"{file_type}s/raw/{file_name}"
        blob = self.container_client.get_blob_client(blob_path)
        with open(local_path, "rb") as data:
            blob.upload_blob(data, overwrite=True)
        logger.info(f"Uploaded {local_path} → {blob_path}")
        return blob_path

    def upload_page_pdf(self, local_path: str, document_name: str, page_num: int, file_type: str):
        base_name = os.path.splitext(os.path.basename(document_name))[0].replace(" ", "_")
        blob_path = f"{file_type}s/{base_name}/{base_name}_page_{page_num}.pdf"
        blob = self.container_client.get_blob_client(blob_path)
        with open(local_path, "rb") as data:
            blob.upload_blob(data, overwrite=True)
        logger.info(f"Uploaded page → {blob_path}")
        return blob_path
