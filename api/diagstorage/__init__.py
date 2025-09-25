import json
import traceback
import azure.functions as func  # type: ignore
from ..shared_blob import debug_storage_config, _get_connection_string, _get_blob_service, UPLOAD_CONTAINER, VIDEO_CONTAINER, QUIZ_CONTAINER  # type: ignore


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    try:
        info = debug_storage_config()
        details = {}
        conn = _get_connection_string()
        svc = _get_blob_service()
        if svc:
            try:
                containers = [
                    c['name'] if isinstance(c, dict) and 'name' in c else getattr(c, 'name', '(unknown)')
                    for c in svc.list_containers()
                ]  # type: ignore
            except Exception as ex:  # noqa: BLE001
                containers = [f"<error listing containers: {ex}>"]

            def exists(name: str) -> bool:
                try:
                    return svc.get_container_client(name).exists()  # type: ignore[attr-defined]
                except Exception:
                    return False

            details = {
                "canConnect": True,
                "connectionStringPrefix": (conn[:25] + "…") if conn else None,
                "containerSample": containers[:25],
                "uploadContainerExists": exists(UPLOAD_CONTAINER),
                "videoContainerExists": exists(VIDEO_CONTAINER),
                "quizContainerExists": exists(QUIZ_CONTAINER),
            }
        else:
            details = {"canConnect": False, "reason": "No connection string resolved or SDK missing"}
        payload = {"summary": info, "storage": details}
        return func.HttpResponse(json.dumps(payload), status_code=200, mimetype="application/json")
    except Exception as ex:  # Broad catch so we never 500 here
        tb = traceback.format_exc(limit=6)
        error_payload = {"error": str(ex), "trace": tb}
        return func.HttpResponse(json.dumps(error_payload), status_code=200, mimetype="application/json")

