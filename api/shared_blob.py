import os
from datetime import datetime
from typing import Tuple, Optional
from azure.storage.blob import BlobServiceClient, ContainerClient

UPLOADED_CONTAINER = os.getenv("KT_UPLOADED_CONTAINER", "uploaded-docs")
VIDEO_CONTAINER = os.getenv("KT_VIDEO_CONTAINER", "generated-videos")
QUIZ_CONTAINER = os.getenv("KT_QUIZ_CONTAINER", "quiz-data")

_cached_client: Optional[BlobServiceClient] = None


def get_blob_service() -> BlobServiceClient:
    global _cached_client
    if _cached_client:
        return _cached_client

    conn = os.getenv("KT_STORAGE_CONNECTION") or os.getenv("AzureWebJobsStorage")
    if not conn:
        raise RuntimeError(
            "No storage connection string found. Set KT_STORAGE_CONNECTION or AzureWebJobsStorage"
        )
    _cached_client = BlobServiceClient.from_connection_string(conn)
    return _cached_client


def ensure_containers():
    svc = get_blob_service()
    for c in (UPLOADED_CONTAINER, VIDEO_CONTAINER, QUIZ_CONTAINER):
        try:
            svc.create_container(c)
        except Exception:
            # Already exists or race; ignore
            pass


def save_uploaded_text(name: str, content: str) -> str:
    ensure_containers()
    if not name.lower().endswith(".txt"):
        name = f"{name}.txt"
    blob_name = name
    svc = get_blob_service()
    container = svc.get_container_client(UPLOADED_CONTAINER)
    container.upload_blob(blob_name, content, overwrite=True)
    return blob_name


def list_uploaded_docs() -> list:
    ensure_containers()
    container = get_blob_service().get_container_client(UPLOADED_CONTAINER)
    return [b.name for b in container.list_blobs()]  # type: ignore


def generate_stub_video(doc_name: str) -> dict:
    # In future, this will read processed results. For now, construct deterministic placeholder.
    ensure_containers()
    scenes = [
        {
            "scene": 1,
            "title": f"Introduction to {doc_name}",
            "narration": f"This is an auto-generated overview of {doc_name}.",
            "durationSeconds": 15,
        },
        {
            "scene": 2,
            "title": "Key Points",
            "narration": f"We highlight the main ideas extracted from {doc_name} (placeholder).",
            "durationSeconds": 25,
        },
        {
            "scene": 3,
            "title": "Summary",
            "narration": "Summary placeholder. AI enrichment pending.",
            "durationSeconds": 10,
        },
    ]
    return {"document": doc_name, "generatedUtc": datetime.utcnow().isoformat() + "Z", "scenes": scenes}


def generate_stub_quiz(doc_name: str) -> dict:
    ensure_containers()
    return {
        "document": doc_name,
        "questions": [
            {
                "id": "q1",
                "text": f"Which statement best describes {doc_name}?",
                "options": [
                    "It's a placeholder doc",
                    "It has been fully AI processed",
                    "It contains confidential data",
                    "It is unrelated to the project",
                ],
                "correctIndex": 0,
            },
            {
                "id": "q2",
                "text": "How many scenes does the stub video produce?",
                "options": ["1", "2", "3", "4"],
                "correctIndex": 2,
            },
        ],
    }


def get_processing_status(doc_name: str) -> dict:
    # Stub status; in future, check for existence of processed blobs.
    ensure_containers()
    uploaded_exists = doc_name in list_uploaded_docs()
    return {
        "document": doc_name,
        "uploaded": uploaded_exists,
        "videoReady": uploaded_exists,  # placeholder logic
        "quizReady": uploaded_exists,   # placeholder logic
        "status": "ready" if uploaded_exists else "missing",
    }
