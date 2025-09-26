import json
import azure.functions as func  # type: ignore
from ..shared_blob import list_known_doc_bases


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    docs = list_known_doc_bases()
    payload = {"documents": docs}
    return func.HttpResponse(
        json.dumps(payload),
        status_code=200,
        mimetype="application/json",
        headers={"Cache-Control": "no-store"},
    )
