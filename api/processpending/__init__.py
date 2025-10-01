import json
import os
import urllib.request
from urllib.error import URLError, HTTPError
import azure.functions as func  # type: ignore

# This Python function proxies the C# ProcessPendingBlobs HTTP triggered function that
# lives in the separate Function App. It allows the Static Web App host to invoke
# manual processing via /api/process/pending.
#
# Expected environment variable:
#   CSHARP_FUNCTION_BASE_URL  - e.g. https://aih...-dotnet.azurewebsites.net
#   CSHARP_FUNCTION_CODE      - (optional) function key if auth level Function
#
# Query params supported: max, force (passed through)

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    base_url = os.getenv("CSHARP_FUNCTION_BASE_URL")
    if not base_url:
        return func.HttpResponse(
            json.dumps({"error": "CSHARP_FUNCTION_BASE_URL not configured"}),
            status_code=500,
            mimetype="application/json"
        )

    # Preserve query string
    qs = req.url.split('?', 1)[1] if '?' in req.url else ''
    target = base_url.rstrip('/') + '/api/process/pending'
    if qs:
        target += '?' + qs

    # Append code if configured and not already present
    func_code = os.getenv("CSHARP_FUNCTION_CODE")
    if func_code and 'code=' not in target:
        sep = '&' if '?' in target else '?'
        target += f"{sep}code={func_code}"

    try:
        with urllib.request.urlopen(target, timeout=60) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            return func.HttpResponse(body, status_code=resp.getcode(), mimetype='application/json')
    except HTTPError as he:
        payload = {"error": "upstream_http_error", "status": he.code, "reason": he.reason}
        return func.HttpResponse(json.dumps(payload), status_code=502, mimetype='application/json')
    except URLError as ue:
        payload = {"error": "upstream_unreachable", "reason": str(ue.reason)}
        return func.HttpResponse(json.dumps(payload), status_code=504, mimetype='application/json')
    except Exception as ex:  # pragma: no cover
        payload = {"error": "proxy_exception", "message": str(ex)}
        return func.HttpResponse(json.dumps(payload), status_code=500, mimetype='application/json')
