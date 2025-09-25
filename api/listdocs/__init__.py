import json
import azure.functions as func
from ..shared_blob import list_uploaded_docs


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    docs = list_uploaded_docs()
    return func.HttpResponse(
        json.dumps({"documents": docs}),
        status_code=200,
        mimetype="application/json",
        headers={"Cache-Control": "no-store"},
    )
