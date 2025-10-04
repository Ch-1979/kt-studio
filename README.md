az functionapp create `
dotnet publish csharp-functions/ProcessKTDocumentFunction.csproj -c Release -o publish
# KT Studio

KT Studio converts uploaded knowledge-transfer documents into an interactive storyboard and a knowledge check. Azure OpenAI supplies the structured scenes and quiz questions, while an optional image deployment can render supporting artwork. Everything is served through an Azure Static Web App with lightweight Azure Functions.

## Highlights
- **Upload ➜ Process ➜ Play** – Users upload `.docx`, `.pdf`, or `.txt` files. A .NET isolated Azure Function watches the storage container and produces a structured storyboard plus quiz.
- **Tidy JSON contracts** – The OpenAI call is schema constrained so the frontend always receives summary, 3–6 scenes, and at least three quiz questions.
- **Optional scene art** – Provide an Azure OpenAI image deployment (DALL·E 3 or `gpt-image-1`) to generate still imagery. When disabled the player falls back to gradients.
- **Pure frontend playback** – No embedded video pipeline; the UI animates scenes, highlights keywords, and drives the quiz experience.
- **Processed doc catalog** – Quickly reload previous runs from blob storage using the processed document dropdown.
- **Document-aware chatbot** – A bottom-left KT Copilot answers follow-up questions using the generated storyboard and quiz context.

## Architecture at a Glance
| Layer | Stack | Purpose |
|-------|-------|---------|
| Static Web App | HTML · CSS · vanilla JS | Upload workflow, storyboard viewer, quiz UI |
| API (SWA Functions) | Python Azure Functions (`api/`) | Upload handler, status polling, manifest + quiz fetch |
| Background processor | .NET 8 isolated Azure Function (`ProcessKTDocument`) | Blob trigger, OpenAI orchestration, quiz/scene JSON emission |
| Storage | Azure Blob Storage | Containers for uploads, generated manifests, quizzes, and optional artwork |

### Processing flow
1. Frontend posts raw bytes to `/api/upload?name=<file>`.
2. The upload function writes the blob to `uploaded-docs`.
3. `ProcessKTDocument` fires, calls Azure OpenAI, enriches scenes, and (optionally) creates image assets.
4. Outputs land in `generated-videos` (`*.video.json`) and `quiz-data` (`*.quiz.json`). Scene art goes to `storyboard-images` if enabled.
5. Frontend polls `/api/status/<doc>` until both manifest and quiz exist, then fetches `/api/video/<doc>` and `/api/quiz/<doc>` for playback.

## Configuration
Apply these settings on the C# Function App (and `local.settings.json` for local runs):

```
AzureOpenAI:Endpoint        = https://<openai-resource>.openai.azure.com/
AzureOpenAI:ApiKey          = <api-key>
AzureOpenAI:Deployment      = gpt-4o-mini       # chat completion that returns storyboard JSON
AzureOpenAI:ChatDeployment  = gpt-4o-mini       # optional override for chatbot responses (defaults to Deployment)
AzureOpenAI:ImageDeployment = dall-e-3          # optional image deployment (omit to skip art)

> ℹ️ Environment keys support multiple naming conventions (`AzureOpenAI:ApiKey`, `AzureOpenAI__ApiKey`, `AZURE_OPENAI_API_KEY`, etc.), so bring your preferred style—just make sure endpoint, API key, deployment name, and API version are populated.
```

The Python Functions rely on `AzureWebJobsStorage`, which Static Web Apps wires automatically.

### Blob containers (auto-created)
| Name | Description |
|------|-------------|
| `uploaded-docs` | Raw document uploads (trigger source) |
| `generated-videos` | Storyboard manifest JSON (`*.video.json`) |
| `quiz-data` | Quiz payloads (`*.quiz.json`) |
| `storyboard-images` | Optional per-scene PNGs |

## Local Development

### Frontend
```powershell
python -m http.server 5500
# then open http://localhost:5500
```
Or use VS Code Live Server / double-click `index.html`.

KT Copilot lives in the bottom-left corner. Once a document is processed or loaded from the catalog, you can ask follow-up questions and it will answer from the generated storyboard and quiz data.

### Python Functions API
```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
func start
```

### C# Blob Trigger
```powershell
cd csharp-functions
dotnet restore
func start
```
Ensure `local.settings.json` contains the Azure Storage connection string plus OpenAI keys.

## HTTP Surface Area
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ping` | GET | Health probe |
| `/api/upload?name=<file>` | POST | Uploads binary document into `uploaded-docs` |
| `/api/status/<doc>` | GET | Returns `{ ready, video, quiz }` flags |
| `/api/video/<doc>` | GET | Retrieves generated storyboard JSON |
| `/api/quiz/<doc>` | GET | Retrieves quiz JSON |
| `/api/chatbot/ask` | POST | Answers KT questions using storyboard + quiz context |
| `/api/list/docs` | GET | Lists known processed document bases |

## Deployment Notes
- GitHub Actions workflow `.github/workflows/azure-static-web-app.yml` publishes the frontend + Python Functions on each push to `main` (requires `AZURE_STATIC_WEB_APPS_API_TOKEN`).
- Deploy the .NET function separately via `func azure functionapp publish`, the provided manual GitHub Action (`deploy-csharp-functions.yml`), or your preferred pipeline.
- Keep Function App app settings in sync across environments; restart after updates.

## Troubleshooting
| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Upload returns 500 | Storage connection string missing | Verify `AzureWebJobsStorage` for both Function Apps |
| Status never flips to ready | Blob trigger not firing | Confirm Function App is running and points to same storage account |
| Quiz missing questions | OpenAI response invalid | Inspect Function logs; fallback content will be emitted automatically |
| Scene art empty | Image deployment unset | Provide `AzureOpenAI:ImageDeployment` or accept gradient fallback |

## Roadmap Ideas
- Add speech synthesis + audio playback.
- Wire telemetry and learner scoring history.
- Allow manual editing of generated scenes before publishing.
- Introduce lightweight authentication (Entra ID) for gated environments.

---
Looking for the older experimental chatbot or Sora integrations? They’ve been removed to keep the codebase focused on the core storyboard + quiz workflow.
