import json
import azure.functions as func  # type: ignore
from ..shared_blob import find_processed_artifacts, debug_storage_config, list_known_doc_bases


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    doc = req.params.get("doc") or (req.route_params.get("doc") if hasattr(req, "route_params") else None)
    base_docs = list_known_doc_bases()
    result = {
        "storage": debug_storage_config(),
        "knownDocuments": base_docs,
    }
    if doc:
        result["requestedDocument"] = doc
        result["artifacts"] = find_processed_artifacts(doc)
    return func.HttpResponse(
        json.dumps(result),
        status_code=200,
        mimetype="application/json",
        headers={"Cache-Control": "no-store"},
    )
