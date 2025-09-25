import json
import azure.functions as func
from ..shared_blob import get_processing_status


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    doc = req.route_params.get("docName") if hasattr(req, "route_params") else None
    if not doc:
        return func.HttpResponse(json.dumps({"error": "Missing docName"}), status_code=400, mimetype="application/json")
    payload = get_processing_status(doc)
    return func.HttpResponse(json.dumps(payload), status_code=200, mimetype="application/json")
