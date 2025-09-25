import json
import traceback
import azure.functions as func
from ..shared_blob import save_uploaded_text

MAX_SIZE = 400_000  # Allow a bit larger since we may base64 or binary fallback


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

    raw_bytes = b""
    if content is None:
        raw_bytes = req.get_body() or b""
        if raw_bytes:
            # Try UTF-8 first, else treat as binary and create a placeholder text for downstream pipeline
            try:
                content = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                # For non-text (docx/pdf) we store a placeholder note plus the byte length
                content = f"[BINARY FILE PLACEHOLDER]\nOriginalName={name}\nSizeBytes={len(raw_bytes)}\n(This will be parsed by the C# processor later.)"

    if not name:
        return _bad("Missing 'name' query or JSON field")
    if not content:
        return _bad("Missing document content in body (raw text, JSON content, or binary file)")
    if len(content) > MAX_SIZE:
        return _bad("Content too large for stub endpoint (400KB limit)")

    try:
        blob_name = save_uploaded_text(name, content)
        base_name = name.rsplit('.', 1)[0]
        response_payload = {
            "savedAs": blob_name,
            "bytes": len(content),
            # Frontend currently expects these (adjusted to its script.js usage):
            "fileName": blob_name,
            "uploadedBytes": len(content),
            "docName": base_name
        }
        return func.HttpResponse(
            json.dumps(response_payload),
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
