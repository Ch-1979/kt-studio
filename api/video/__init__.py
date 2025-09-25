import json
import azure.functions as func  # type: ignore
from ..shared_blob import generate_stub_video, load_processed_video


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    doc = req.route_params.get("docName") if hasattr(req, "route_params") else None
    if not doc:
        return func.HttpResponse(json.dumps({"error": "Missing docName"}), status_code=400, mimetype="application/json")
    base = doc
    real = load_processed_video(base)
    payload = real or generate_stub_video(base)
    return func.HttpResponse(json.dumps(payload), status_code=200, mimetype="application/json", headers={"Cache-Control": "no-store"})
