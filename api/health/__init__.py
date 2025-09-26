import json, azure.functions as func  # type: ignore

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    return func.HttpResponse(json.dumps({"status":"ok","message":"Functions host responding"}), status_code=200, mimetype="application/json")
