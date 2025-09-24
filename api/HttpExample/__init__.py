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

@app.route(route="ping")
def ping(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("pong", status_code=200)

@app.route(route="quiz/sample")
def quiz_sample(req: func.HttpRequest) -> func.HttpResponse:
    sample = {
        "questions": [
            {
                "id": "q1",
                "text": "What is the primary database used in Project Alpha's architecture?",
                "options": ["MySQL", "PostgreSQL", "Cosmos DB", "MongoDB"],
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


@app.route(route="video/{docName}")
def get_video(req: func.HttpRequest) -> func.HttpResponse:
    doc_name = req.route_params.get("docName") or ""
    doc_name = _safe_doc_name(doc_name)
    # Accept both with or without .video.json suffix
    if doc_name.endswith('.video.json'):
        blob_name = doc_name
    else:
        # if user supplied .txt original name, transform
        if doc_name.endswith('.txt'):
            base = doc_name[:-4]
        else:
            base = doc_name
        blob_name = f"{base}.video.json"
    payload = None
    try:
        payload = _download_json("generated-videos", blob_name)
    except Exception as ex:  # log and return error
        logging.exception("Error retrieving video json")
        return func.HttpResponse(
            json.dumps({"error": str(ex)}),
            status_code=500,
            mimetype="application/json"
        )
    if payload is None:
        return func.HttpResponse(
            json.dumps({"error": "Not found", "blob": blob_name}),
            status_code=404,
            mimetype="application/json"
        )
    return func.HttpResponse(
        json.dumps(payload),
        mimetype="application/json",
        status_code=200,
        headers={"Cache-Control": "no-store"}
    )


@app.route(route="quiz/{docName}")
def get_quiz(req: func.HttpRequest) -> func.HttpResponse:
    doc_name = req.route_params.get("docName") or ""
    doc_name = _safe_doc_name(doc_name)
    if doc_name.endswith('.quiz.json'):
        blob_name = doc_name
    else:
        if doc_name.endswith('.txt'):
            base = doc_name[:-4]
        else:
            base = doc_name
        blob_name = f"{base}.quiz.json"
    try:
        payload = _download_json("quiz-data", blob_name)
    except Exception as ex:
        logging.exception("Error retrieving quiz json")
        return func.HttpResponse(json.dumps({"error": str(ex)}), status_code=500, mimetype="application/json")
    if payload is None:
        return func.HttpResponse(json.dumps({"error": "Not found", "blob": blob_name}), status_code=404, mimetype="application/json")
    return func.HttpResponse(json.dumps(payload), mimetype="application/json", status_code=200, headers={"Cache-Control": "no-store"})


@app.route(route="list/docs")
def list_docs(req: func.HttpRequest) -> func.HttpResponse:
    try:
        svc = _get_blob_service()
        container_client = svc.get_container_client("generated-videos")
        if not container_client.exists():
            return func.HttpResponse(json.dumps({"documents": []}), mimetype="application/json")
        docs: List[str] = []
        for blob in container_client.list_blobs():  # type: ignore
            if blob.name.endswith('.video.json'):
                docs.append(blob.name[:-11])  # strip .video.json
        return func.HttpResponse(json.dumps({"documents": sorted(docs)}), mimetype="application/json")
    except Exception as ex:
        logging.exception("Error listing documents")
        return func.HttpResponse(json.dumps({"error": str(ex)}), status_code=500, mimetype="application/json")


# ---------------- New: Upload & Status Endpoints ---------------- #
@app.route(route="upload", methods=["POST"])  # raw body upload; header x-file-name or query ?name=
def upload_doc(req: func.HttpRequest) -> func.HttpResponse:
    try:
        file_name = req.params.get("name") or req.headers.get("x-file-name") or ""
        if not file_name:
            return func.HttpResponse(json.dumps({"error": "Missing file name (use ?name= or x-file-name header)"}), status_code=400, mimetype="application/json")
        file_name = _safe_doc_name(file_name)
        # Normalize extension; if none, default .txt (blob trigger will still fire)
        if '.' not in file_name:
            file_name += '.txt'
        body = req.get_body() or b""
        if not body:
            return func.HttpResponse(json.dumps({"error": "Empty body"}), status_code=400, mimetype="application/json")
        svc = _get_blob_service()
        container = 'uploaded-docs'
        container_client = svc.get_container_client(container)
        if not container_client.exists():
            container_client.create_container()
        blob_client = container_client.get_blob_client(file_name)
        blob_client.upload_blob(body, overwrite=True)
        logging.info("Uploaded document %s (%d bytes)", file_name, len(body))
        base = file_name.rsplit('.', 1)[0]
        return func.HttpResponse(
            json.dumps({
                "docName": base,
                "fileName": file_name,
                "uploadedBytes": len(body),
                "timestamp": datetime.utcnow().isoformat() + 'Z'
            }),
            status_code=201,
            mimetype="application/json"
        )
    except Exception as ex:
        logging.exception("Upload failed")
        return func.HttpResponse(json.dumps({"error": str(ex)}), status_code=500, mimetype="application/json")


@app.route(route="status/{docName}")
def status_doc(req: func.HttpRequest) -> func.HttpResponse:
    doc_name = req.route_params.get("docName") or ""
    doc_name = _safe_doc_name(doc_name)
    if doc_name.endswith('.txt'):
        base = doc_name[:-4]
    else:
        base = doc_name
    try:
        svc = _get_blob_service()
        video_blob = f"{base}.video.json"
        quiz_blob = f"{base}.quiz.json"
        video_exists = False
        quiz_exists = False
        try:
            vc = svc.get_container_client('generated-videos')
            if vc.exists():
                video_exists = vc.get_blob_client(video_blob).exists()
        except Exception:  # pragma: no cover - ignore
            pass
        try:
            qc = svc.get_container_client('quiz-data')
            if qc.exists():
                quiz_exists = qc.get_blob_client(quiz_blob).exists()
        except Exception:  # pragma: no cover
            pass
        status = {
            "docName": base,
            "video": video_exists,
            "quiz": quiz_exists,
            "ready": video_exists and quiz_exists
        }
        return func.HttpResponse(json.dumps(status), mimetype="application/json", status_code=200)
    except Exception as ex:
        logging.exception("Status check failed")
        return func.HttpResponse(json.dumps({"error": str(ex)}), status_code=500, mimetype="application/json")
