# Azure Functions Backend (Starter)

This folder (`api/`) is an Azure Functions (Python) starter so the deployment tooling recognizes a valid Function App.

## Functions
Implemented classic (function.json) HTTP triggers:

| Route | Method(s) | Description |
|-------|-----------|-------------|
| /api/ping | GET | Liveness check returning `pong` |
| /api/debug-test | GET | Returns `classic-ok` to verify deployment |
| /api/quiz/sample | GET | Static sample quiz JSON |
| /api/upload | POST | Upload raw text body or JSON { name, content } to blob storage |
| /api/list/docs | GET | List uploaded document blob names |
| /api/video/{docName} | GET | Generate stub video scene JSON for a document |
| /api/quiz/{docName} | GET | Generate stub quiz JSON for a document |
| /api/status/{docName} | GET | Returns stub processing status flags |

Environment variable overrides (optional):
* KT_STORAGE_CONNECTION (defaults to AzureWebJobsStorage)
* KT_UPLOADED_CONTAINER (default uploaded-docs)
* KT_VIDEO_CONTAINER (default generated-videos)
* KT_QUIZ_CONTAINER (default quiz-data)

These are currently stub implementations; future iterations will replace stub generators with AI-assisted processing outputs.

## Local Development
Install Azure Functions Core Tools & Python deps:
```bash
pip install -r requirements.txt
func start
```

## Deploy
Use VS Code Azure extension or Azure CLI:
```bash
func azure functionapp publish <YourFunctionAppName>
```

Ensure you set `FUNCTIONS_WORKER_RUNTIME=python` in Azure configuration if not auto-detected.
