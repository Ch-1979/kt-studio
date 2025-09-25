import json
import os
import azure.functions as func

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    root = os.path.dirname(__file__)  # this folder (diagfunctions)
    api_root = os.path.abspath(os.path.join(root, ".."))
    entries = []
    for name in sorted(os.listdir(api_root)):
        full = os.path.join(api_root, name)
        if os.path.isdir(full):
            fj = os.path.join(full, "function.json")
            if os.path.exists(fj):
                entries.append(name)
    payload = {"detectedFunctionFolders": entries}
    return func.HttpResponse(json.dumps(payload, indent=2), status_code=200, mimetype="application/json")
