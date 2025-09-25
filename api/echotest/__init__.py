import json
import azure.functions as func

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    msg = req.params.get("m") or "echo-ok"
    return func.HttpResponse(json.dumps({"echo": msg}), status_code=200, mimetype="application/json")
