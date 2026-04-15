from app.services.ingestion_local_service import get_documents_local
# or: from app.services.ingestion_azure_service import get_documents_azure

docs = get_documents_local()  # or get_documents_azure()

for d in docs:
    print("\n==============================")
    print(f"PDF: {d.metadata['document_id']}")
    print(f"Page: {d.metadata['page']}")
    print("\nContent:")
    print(d.page_content[:500])  # limit if needed

    print("\nMetadata:")
    print({
        "source": d.metadata["source"],
        "page": d.metadata["page"],
        "tags": d.metadata.get("tags", [])
    })