import os
from dotenv import load_dotenv
load_dotenv()


class Settings:
    # ========================
    # 🔐 Azure Auth (Service Principal)
    # ========================
    AZURE_CLIENT_ID: str = os.getenv("AZURE_CLIENT_ID")
    AZURE_TENANT_ID: str = os.getenv("AZURE_TENANT_ID")
    AZURE_CLIENT_SECRET: str = os.getenv("AZURE_CLIENT_SECRET")

    # ========================
    # 📦 Azure Storage
    # ========================
    AZURE_STORAGE_ACCOUNT: str = os.getenv("AZURE_STORAGE_ACCOUNT")
    AZURE_STORAGE_CONTAINER: str = os.getenv("AZURE_STORAGE_CONTAINER")
    # ========================
    # 📄 Azure Document Intelligence
    # ========================
    AZURE_DOC_INTEL_ENDPOINT: str = os.getenv("AZURE_DOC_INTEL_ENDPOINT")

    # ========================
    # 🗄️ Database
    # ========================
    DATABASE_URL: str = os.getenv("DATABASE_URL")

    # ========================
    # ⚙️ App Config (optional)
    # ========================
    ENV: str = os.getenv("ENV", "dev")
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"


# Singleton instance
settings = Settings()