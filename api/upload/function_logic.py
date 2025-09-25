import json
import traceback
import azure.functions as func
from ..shared_blob import save_uploaded_text

MAX_SIZE = 200_000  # 200 KB text limit for now


def _bad(msg: str, code: int = 400) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"error": msg}), status_code=code, mimetype="application/json")


def handle(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    method = req.method.upper()
    if method == "OPTIONS":
        # CORS / preflight support (frontend frameworks sometimes send this)
        return func.HttpResponse(
            "",
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST,OPTIONS",
                "Access-Control-Allow-Headers": "content-type",
            },
        )
    if method != "POST":
        return _bad("Only POST supported", 405)

    name = req.params.get("name") or (req.route_params.get("name") if hasattr(req, 'route_params') else None)
    if not name:
        # try json body field
        try:
            body_json = req.get_json()
            name = body_json.get("name")
            content = body_json.get("content")
        except Exception:
            body_json = {}
            content = None
    else:
        body_json = {}
        content = None

    if content is None:
        raw_bytes = req.get_body() or b""
        if raw_bytes:
            try:
                content = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                return _bad("Body must be UTF-8 text or provide JSON with content")

    if not name:
        return _bad("Missing 'name' query or JSON field")
    if not content:
        return _bad("Missing document content in body (raw text or JSON content field)")
    if len(content) > MAX_SIZE:
        return _bad("Content too large for stub endpoint (200KB limit)")

    try:
        blob_name = save_uploaded_text(name, content)
        return func.HttpResponse(
            json.dumps({"savedAs": blob_name, "bytes": len(content)}),
            status_code=200,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    except Exception as ex:  # noqa: BLE001
        tb = traceback.format_exc(limit=3)
        err_payload = {
            "error": "Storage operation failed",
            "message": str(ex),
            "trace": tb,
        }
        return func.HttpResponse(
            json.dumps(err_payload),
            status_code=500,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )
