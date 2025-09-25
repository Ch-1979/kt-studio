import json
import traceback
import azure.functions as func
from ..shared_blob import save_uploaded_text

def handle(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse(
            "",
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST,OPTIONS",
                "Access-Control-Allow-Headers": "content-type",
            },
        )
    if req.method.upper() != "POST":
        return func.HttpResponse(json.dumps({"error": "POST only"}), status_code=405, mimetype="application/json")

    # Accept raw or JSON
    name = req.params.get("name")
    content = None
    if not name:
        try:
            body = req.get_json()
            name = body.get("name")
            content = body.get("content")
        except Exception:
            pass
    if content is None:
        raw = req.get_body() or b""
        if raw:
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                return func.HttpResponse(json.dumps({"error": "UTF-8 body required"}), status_code=400, mimetype="application/json")
    if not name or not content:
        return func.HttpResponse(json.dumps({"error": "Missing name or content"}), status_code=400, mimetype="application/json")

    try:
        blob_name = save_uploaded_text(name, content)
        return func.HttpResponse(
            json.dumps({"savedAs": blob_name, "bytes": len(content), "route": "testupload"}),
            status_code=200,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    except Exception as ex:  # noqa: BLE001
        return func.HttpResponse(
            json.dumps({
                "error": "Storage failure",
                "message": str(ex),
                "trace": traceback.format_exc(limit=2),
                "route": "testupload"
            }),
            status_code=500,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )
