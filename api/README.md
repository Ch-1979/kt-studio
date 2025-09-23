# Azure Functions Backend (Starter)

This folder (`api/`) is an Azure Functions (Python) starter so the deployment tooling recognizes a valid Function App.

## Functions
- `ping` -> GET /api/ping returns `pong`
- `quiz/sample` -> GET /api/quiz/sample returns sample quiz JSON

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
