import json, os, azure.functions as func  # type: ignore

KEYS = [
    "PREFERRED_BLOB_CONNECTION",
    "BLOB_CONNECTION_STRING",
    "AZURE_STORAGE_CONNECTION_STRING",
    "blob_connection_string",
    "AzureWebJobsStorage",
]

MASK = lambda v: (v[:18] + "…" + v[-6:]) if v and len(v) > 32 else v  # noqa: E731

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    data = {k: ("set", MASK(os.getenv(k) or "")) if os.getenv(k) else ("missing", None) for k in KEYS}
    # Distinguish which one would be chosen by current precedence (same as shared_blob order)
    chosen = None
    for k in [
        "PREFERRED_BLOB_CONNECTION",
        "BLOB_CONNECTION_STRING",
        "AZURE_STORAGE_CONNECTION_STRING",
        "blob_connection_string",
        "AzureWebJobsStorage",
    ]:
        if os.getenv(k):
            chosen = k
            break
    payload = {"envVars": data, "chosen": chosen}
    return func.HttpResponse(json.dumps(payload), status_code=200, mimetype="application/json")
