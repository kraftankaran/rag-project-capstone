import os
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class AzureStorageService:
    def __init__(self):
        print("CONTAINER:", settings.AZURE_STORAGE_CONTAINER)
        self.client = BlobServiceClient(
            account_url=f"https://{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net",
            credential=DefaultAzureCredential()
        )
        self.container_client = self.client.get_container_client(
            settings.AZURE_STORAGE_CONTAINER
        )

    def list_pdfs(self):
        blobs = [
            blob.name
            for blob in self.container_client.list_blobs()
            if blob.name.endswith(".pdf")
        ]
        logger.info(f"Found {len(blobs)} PDFs in Azure")
        return blobs

    def download_file(self, blob_path: str, local_path: str):
        blob = self.container_client.get_blob_client(blob_path)

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        with open(local_path, "wb") as f:
            f.write(blob.download_blob().readall())

        logger.info(f"Downloaded {blob_path} → {local_path}")

        return local_path
    
    def upload_file(self, local_path: str, file_type: str, blob_path: str = None):
        if not blob_path:
            file_name = os.path.basename(local_path)
            file_name = (
                file_name
                .replace(" ", "_")
            )
            blob_path = f"{file_type}s/raw/{file_name}" 

        blob = self.container_client.get_blob_client(blob_path)

        with open(local_path, "rb") as data:
            blob.upload_blob(data, overwrite=True)

        logger.info(f"Uploaded {local_path} → {blob_path}")

        return blob_path
    
    def upload_page_pdf(self, local_path: str, document_name: str, page_num: int, file_type: str):
        base_name = os.path.splitext(os.path.basename(document_name))[0]

        base_name = (
            base_name
            .replace(" ", "_")
        )

        blob_path = f"{file_type}s/{base_name}/{base_name}_page_{page_num}.pdf"

        blob = self.container_client.get_blob_client(blob_path)

        with open(local_path, "rb") as data:
            blob.upload_blob(data, overwrite=True)

        logger.info(f"Uploaded page → {blob_path}")

        return blob_path