import logging
import json
import os
from typing import List
import azure.functions as func
from datetime import datetime

try:
    from azure.storage.blob import BlobServiceClient  # type: ignore
except Exception:  # pragma: no cover
    BlobServiceClient = None  # type: ignore

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

#############################################
# TEMPORARY DEBUG-ONLY FUNCTION
# All other routes are commented out below to isolate a startup failure.
#############################################

@app.route(route="debug-test")
def debug_test(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("OK", status_code=200)

# Stage 1 restore: simple ping (no storage dependency)
@app.route(route="ping")
def ping(req: func.HttpRequest) -> func.HttpResponse:  # minimal health check
    return func.HttpResponse("pong", status_code=200)

# Stage 2 restore (Batch A): quiz/sample (pure in-memory JSON)
@app.route(route="quiz/sample")
def quiz_sample(req: func.HttpRequest) -> func.HttpResponse:
    sample = {
        "questions": [
            {
                "id": "q1",
                "text": "What is the primary database used in Project Alpha's architecture?",
                "options": ["MySQL", "PostgreSQL", "Cosmos DB", "MongoDB"],
                "correctIndex": 1
            },
            {
                "id": "q2",
                "text": "Which layer will we enhance next with Azure OpenAI?",
                "options": ["Frontend UI", "Blob Trigger Orchestrator", "Database Engine", "On-Prem Agent"],
                "correctIndex": 1
            }
        ]
    }
    return func.HttpResponse(
        body=json.dumps(sample),
        mimetype="application/json",
        status_code=200,
        headers={"Cache-Control": "no-store"}
    )

# --- Original routes temporarily disabled for diagnostics ---
# @app.route(route="ping")
# def ping(req: func.HttpRequest) -> func.HttpResponse:
#     return func.HttpResponse("pong", status_code=200)

# @app.route(route="quiz/sample")
# def quiz_sample(req: func.HttpRequest) -> func.HttpResponse:
#     sample = { ... }
#     return func.HttpResponse(
#         body=json.dumps(sample),
#         mimetype="application/json",
#         status_code=200,
#         headers={"Cache-Control": "no-store"}
#     )


# -------- Storage Helpers -------- #
def _get_blob_service():
    if BlobServiceClient is None:
        raise RuntimeError("azure-storage-blob not installed; add to requirements.txt")
    conn = os.getenv("AzureWebJobsStorage") or os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise RuntimeError("Missing AzureWebJobsStorage / BLOB_CONNECTION_STRING in configuration")
    return BlobServiceClient.from_connection_string(conn)


def _safe_doc_name(name: str) -> str:
    # strip path, keep base, no traversal
    base = name.split('/')[-1].split('\\')[-1]
    return base.replace('..', '_')


def _download_json(container: str, blob_name: str):
    svc = _get_blob_service()
    container_client = svc.get_container_client(container)
    if not container_client.exists():
        return None
    if not container_client.get_blob_client(blob_name).exists():
        return None
    stream = container_client.download_blob(blob_name)
    data = stream.readall()
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return {"raw": data.decode('utf-8', errors='replace')}


# @app.route(route="video/{docName}")
# def get_video(req: func.HttpRequest) -> func.HttpResponse:
#     ...


# @app.route(route="quiz/{docName}")
# def get_quiz(req: func.HttpRequest) -> func.HttpResponse:
#     ...


# @app.route(route="list/docs")
# def list_docs(req: func.HttpRequest) -> func.HttpResponse:
#     ...


# ---------------- New: Upload & Status Endpoints ---------------- #
# @app.route(route="upload", methods=["POST"])  # raw body upload
# def upload_doc(req: func.HttpRequest) -> func.HttpResponse:
#     ...


# @app.route(route="status/{docName}")
# def status_doc(req: func.HttpRequest) -> func.HttpResponse:
#     ...
