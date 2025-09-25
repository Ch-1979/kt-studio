import json
import azure.functions as func  # type: ignore
from ..shared_blob import debug_storage_config

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    info = debug_storage_config()
    return func.HttpResponse(json.dumps(info), status_code=200, mimetype="application/json")
