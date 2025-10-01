import json
import os
import traceback
import azure.functions as func  # type: ignore

try:
    # Prefer the existing relative import style used elsewhere
    from ..shared_blob import (
        find_processed_artifacts,
        debug_storage_config,
        list_known_doc_bases,
    )
except Exception:  # pragma: no cover - if relative fails, try absolute
    try:
        from shared_blob import (
            find_processed_artifacts,
            debug_storage_config,
            list_known_doc_bases,
        )  # type: ignore
    except Exception:
        # Defer raising; we'll surface in handler
        find_processed_artifacts = None  # type: ignore
        debug_storage_config = None  # type: ignore
        list_known_doc_bases = None  # type: ignore


def _safe(obj, default):
    try:
        return obj() if callable(obj) else default
    except Exception:
        return default


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    try:
        doc = req.params.get("doc") or (req.route_params.get("doc") if hasattr(req, "route_params") else None)

        import_ok = all([
            callable(list_known_doc_bases) if list_known_doc_bases else False,
            callable(debug_storage_config) if debug_storage_config else False,
        ])

        base_docs = _safe(list_known_doc_bases, []) if list_known_doc_bases else []
        storage_info = _safe(debug_storage_config, {"error": "debug_storage_config unavailable"}) if debug_storage_config else {"error": "import failed"}

        result = {
            "status": "ok" if import_ok else "degraded",
            "storage": storage_info,
            "knownDocuments": base_docs,
            "pythonVersion": os.getenv("PYTHON_VERSION", "unknown"),
            "workingDir": os.getcwd(),
            "envSample": {k: os.getenv(k, "") for k in ["AzureWebJobsStorage", "AZURE_OPENAI_ENDPOINT", "AzureWebJobsFeatureFlags"]},
        }
        if doc and find_processed_artifacts:
            result["requestedDocument"] = doc
            result["artifacts"] = _safe(lambda: find_processed_artifacts(doc), {})

        return func.HttpResponse(
            json.dumps(result, indent=2),
            status_code=200,
            mimetype="application/json",
            headers={"Cache-Control": "no-store"},
        )
    except Exception as ex:  # Surface the traceback instead of raw 500 HTML
        payload = {
            "status": "error",
            "message": str(ex),
            "traceback": traceback.format_exc(),
        }
        return func.HttpResponse(
            json.dumps(payload, indent=2),
            status_code=500,
            mimetype="application/json",
            headers={"Cache-Control": "no-store"},
        )
