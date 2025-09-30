# AI-Powered KT Studio (Frontend MVP)

This is the initial static frontend prototype for the AI-Powered KT (Knowledge Transition) Studio. It lets a user:

1. Select and "upload" (simulated) a KT document
2. See a simulated processing flow turning the document into a video
3. Interact with a mock video player UI (diagram + narration text + controls)
4. Take a sample quiz and get immediate feedback

No real backend, storage, AI, or video generation is wired in yet—this is the UI foundation for fast iteration and upcoming integration with Azure services.

---
## ✅ Files
- `index.html` – Page structure & layout
- `style.css` – Styling (cards, grid layout, dark video area, responsive tweaks)
- `script.js` – UI state simulation (upload → processing → ready → quiz)
- `api/` – Python Azure Functions (quiz + ping)
- `csharp-functions/` – C# isolated Azure Functions (Blob-trigger pipeline scaffold)

---
## 🚀 How to Run Locally
### Option 1: Easiest (Just Open)
1. Open the folder in File Explorer
2. Double‑click `index.html`
3. It opens in your default browser (Edge/Chrome). Done.

### Option 2: VS Code Live Server (Recommended for Dev)
1. Open the folder in VS Code
2. Install the extension: "Live Server" (Ritwick Dey)
3. Right‑click `index.html` → "Open with Live Server"
4. Browser opens at something like: `http://127.0.0.1:5500/`

### Option 3: PowerShell Helper Script (No Python Needed)
1. In File Explorer: right‑click `start_local.ps1` → Run with PowerShell (if blocked, click "Run once")
2. It will try python / node / fallback to opening the file directly
3. When a server starts you’ll see a URL like `http://localhost:5500`

If execution policy blocks it:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
./start_local.ps1
```

### Option 4: Lightweight Python HTTP Server
```powershell
# From the project folder
python -m http.server 5500
# Then open http://localhost:5500 in your browser
```

If `python` command not found, try:
```powershell
py -m http.server 5500
 - Real upload endpoint (`POST /api/upload`) storing raw file in `uploaded-docs` (triggers C# function)
 - Document status endpoint (`GET /api/status/{docName}`) used by frontend polling until both video & quiz are ready
```

### Option 5: Node.js Static Server (if you have Node)
```powershell
# One-time install (optional)
npm install -g serve
# Run
serve -p 5500 .
# Open http://localhost:5500
 | `/api/upload?name={fileName}` | POST | Upload raw KT document (body = file bytes) |
 | `/api/status/{docName}` | GET | Check readiness (video + quiz) |
```

---
 2. Frontend sends `POST /api/upload?name=<filename>` with raw bytes. Azure Function stores blob in `uploaded-docs`.
 3. Blob Trigger (C# Function App) detects new blob and generates:
      - `<base>.video.json` -> `generated-videos` container
      - `<base>.quiz.json` -> `quiz-data` container
 4. Frontend polls `GET /api/status/<base>` every ~6s until both artifacts exist.
 5. Once ready, frontend auto-fetches `/api/video/<base>` + `/api/quiz/<base>` and wires scenes & quiz.
 6. User watches scripted scene progression & takes generated quiz.
2. Click "Choose File to Upload" → pick any `.docx`/`.pdf`/`.txt` (any file works)
3. You see: "File selected: yourfile.docx"
4. Status changes: `Awaiting upload...` → `Processing...` → `Ready!`
5. "Watch Video" button appears → click it
6. Video area title updates → press Play (triangle) → progress bar starts moving
7. After a moment, a "Take Quiz" button appears → click it
8. Quiz shows with 4 options → select one → "Submit Answers" → feedback appears

---
## 🧪 Developer Shortcut (Demo Mode)
Open the browser DevTools console and type:
```javascript
runDemo();
```
That auto-simulates the upload → processing flow.

Keyboard shortcuts:
- Space: Play/Pause mock video
- Left/Right Arrow: Seek -5% / +5%

---
## 🌐 Deploy to Azure (Fast Path)
### Option A (Recommended) – Azure Static Web Apps (Frontend + Functions API)
You now have a minimal Azure Functions backend in `api/`. We added a workflow at `.github/workflows/azure-static-web-app.yml`.

Steps:
1. Create a new GitHub repository and push this whole folder (keep structure: root files + `api/`).
2. In Azure Portal: Create Resource → "Static Web App".
3. Authentication: pick your GitHub org/repo/branch (`main` or `master`).
4. App build settings:
   - App location: `/`
   - API location: `api`
   - Output location: `/` (leave blank in portal or use `/`)
5. After creation Azure provides a deployment token if not auto-injected. If needed:
   - Go to the Static Web App → Settings → Manage deployment token → Copy.
   - In GitHub repo: Settings → Secrets → Actions → New secret → Name: `AZURE_STATIC_WEB_APPS_API_TOKEN` → Paste token.
6. Push/commit triggers the GitHub Action and deploys.
7. Access the site at: `https://<generated-name>.azurestaticapps.net` (shown in the portal / Action log).
8. Test API endpoints:
   - `https://<generated-name>.azurestaticapps.net/api/ping`
   - `https://<generated-name>.azurestaticapps.net/api/quiz/sample`

If you later add build tooling (Node, bundlers), remove `skip_app_build: true` in the workflow.

### Option B – Azure App Service (if you’ll add backend soon)
1. Create Web App (Runtime: Node 18 or Python 3.11—either is fine for static files)
2. Go to Deployment Center → Connect GitHub repo/branch
3. Add a simple server later (Flask/Express) to serve static + APIs

### Option C – Azure Storage Static Website
1. Create a Storage Account → Enable "Static Website"
2. Upload `index.html`, `style.css`, `script.js` into `$web` container
3. Use the primary endpoint URL

---
## 🔐 CORS & Future Backend
When you add real uploads (Blob Storage) or functions:
- Configure CORS to allow your domain: `https://<yourapp>.azurestaticapps.net`
- For local dev also allow: `http://localhost:5500`
- Use SAS tokens or user delegation for secure uploads

---
## 🛣️ Next Feature Ideas
| Priority | Feature | Notes |
|----------|---------|-------|
| High | Real file upload → Azure Blob | Use Azure Storage JS SDK + SAS token Function |
| High | Backend orchestration | FastAPI/Functions to trigger doc→video pipeline |
| High | Quiz API + scoring | Store user attempts, analytics |
| Medium | Auth (Entra ID / GitHub) | Gate access, personal workspaces |
| Medium | Multi-slide video storyboard | Break doc into semantic scenes |
| Medium | Real TTS narration | Azure Cognitive Services Speech |
| Low | Theme switch (dark/light) | CSS variables |
| Low | Progress persistence | LocalStorage or user profile |

---
## 🧩 Integration Stubs (Planned)
You can later replace simulated steps with real calls:
- Processing status: Poll `/api/status/<jobId>`
- Video manifest: Fetch `/api/video/<docId>`
- Quiz fetch: GET `/api/quiz/<docId>`
- Quiz submit: POST `/api/quiz/<docId>/submit`

---
## 🧪 Basic Health Checklist
| Aspect | Status |
|--------|--------|
| Loads in modern browsers | ✅ |
| Responsive (desktop/tablet) | ✅ |
| No external runtime required | ✅ |
| Simulated state flows work | ✅ |
| Error handling (basic) | Minimal (OK for MVP) |
| C# pipeline scaffold present | ✅ (not wired into deployment) |

---
## 🧵 Multiple Deployment Workflows (Clean Up Advice)
You currently have TWO GitHub Actions workflows for Azure Static Web Apps:

1. `azure-static-web-app.yml` (custom – supports Python API + future build tweaks)
2. Auto-generated `azure-static-web-apps-<name>.yml` (added by Azure portal – no API configured)

Recommendation: keep ONLY the custom one so the Python API keeps deploying. To remove the auto one:
```
git rm .github/workflows/azure-static-web-apps-*.yml
git commit -m "chore: remove auto-generated SWA workflow"
git push
```
Then ensure the secret `AZURE_STATIC_WEB_APPS_API_TOKEN` exists (or recreate via portal). Future pushes will use the custom workflow.

---
## 🏗️ Architecture: Frontend + Python API + Background C# Processing
| Layer | Tech | Path | Trigger / Access | Purpose |
|-------|------|------|------------------|---------|
| UI | Static HTML/CSS/JS | `/` | Browser | User interaction, upload simulation, video & quiz UI |
| Lightweight HTTP API | Azure Functions (Python) | `api/` | HTTP (`/api/...`) | Quiz data, health/ping, future metadata fetch |
| Background Processor | Azure Functions (C# isolated) | `csharp-functions/` | Blob Trigger (`uploaded-docs`) | Transform docs → summary, scenes, audio, quiz JSON |
| Storage | Azure Blob Storage | (containers) | Blob operations | Persist raw docs & generated assets |

### Why Two Function Apps?
- Static Web Apps embedded Functions is great for HTTP routes but does NOT support Blob Triggers.
- The C# blob-trigger function must run in a separate Function App (Consumption/Premium) bound to the same storage account.

### Processing Flow (Target State)
1. User uploads document (future: direct to `uploaded-docs` via SAS or an HTTP upload endpoint).
2. Blob appears → C# Function `ProcessKTDocument` fires.
3. OpenAI summary/script/quiz produced; Speech synthesizes scene audio.
4. Artifacts written to: `generated-videos`, `generated-audio`, `quiz-data`.
5. Frontend (via Python API or direct blob access) loads processed content for playback & quiz.

### Required Blob Containers
```
uploaded-docs
generated-audio
generated-videos
quiz-data
storyboard-images
```

Create them (one-time) with Azure CLI:
```powershell
$STORAGE="<storage-account-name>"
az storage container create --name uploaded-docs --account-name $STORAGE
az storage container create --name generated-audio --account-name $STORAGE
az storage container create --name generated-videos --account-name $STORAGE
az storage container create --name quiz-data --account-name $STORAGE
az storage container create --name storyboard-images --account-name $STORAGE
```

### Deploying the C# Function Separately
Option A (VS Code): Use Azure Functions extension → Deploy.

Option B (CLI):
```powershell
$RG="rg-kt-studio-dev"
$LOC="eastus"
$APP="ktstudio-csharp-func"  # must be globally unique
$STORAGE="<storage-account-name>"

az functionapp create `
   --resource-group $RG `
   --consumption-plan-location $LOC `
   --runtime dotnet-isolated `
   --functions-version 4 `
   --name $APP `
   --storage-account $STORAGE

dotnet publish csharp-functions/ProcessKTDocumentFunction.csproj -c Release -o publish
cd publish
func azure functionapp publish $APP
```

Option C (GitHub Actions Manual Trigger):
1. Add publish profile secret: In Function App Portal → Get Publish Profile → copy XML → GitHub repo → Settings → Secrets → Actions → New secret → Name: `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`.
2. In GitHub → Actions → Run workflow → Select "Deploy C# Blob Trigger Function (Manual)" → supply (or keep defaults) → Run.
3. Workflow uses `.github/workflows/deploy-csharp-functions.yml` to build & deploy.

### App Settings to Configure on the C# Function App
```powershell
az functionapp config appsettings set -g $RG -n $APP --settings \
   AzureOpenAI:Endpoint="https://YOUR_OPENAI_RESOURCE.openai.azure.com/" \
   AzureOpenAI:ApiKey="<OPENAI_KEY>" \
   AzureOpenAI:Deployment="gpt-4o-mini" \
   AzureOpenAI:ImageDeployment="gpt-image-1" \
   Speech:ApiKey="<SPEECH_KEY>" \
   Speech:Region="<SPEECH_REGION>" \
   Speech:Voice="en-US-JennyNeural"
```

### Local Test of C# Processing
```powershell
cd csharp-functions
func start
Set-Content sample.txt "Sample KT onboarding doc about platform A." 
az storage blob upload -c uploaded-docs -f sample.txt -n sample.txt --account-name <storage>
```
Watch console for logs; expect creation of JSON + (placeholder) audio entries.

### Helper Scripts
| Script | Purpose |
|--------|---------|
| `scripts/deploy_csharp_function.ps1` | One-shot create+publish of Function App (local) |
| `scripts/trigger_sample_blob.ps1` | Upload sample blob to trigger processing |

Examples:
```powershell
./scripts/deploy_csharp_function.ps1 -StorageAccount <storage> -FunctionAppName ktstudio-csharp-func -ResourceGroup rg-kt-studio-dev
./scripts/trigger_sample_blob.ps1 -StorageAccount <storage> -FileName onboarding-doc.txt
```

### Serving Generated Assets
Add (future) Python HTTP endpoints:
```
GET /api/video/{docName}    => returns video JSON from generated-videos
GET /api/quiz/{docName}     => returns quiz JSON from quiz-data
```
Or expose a listing endpoint to enumerate processed docs.

---

---
## ❓ Troubleshooting
| Issue | Fix |
|-------|-----|
| Styles not loading | Check `style.css` path (same folder) |
| Icons missing | Ensure Font Awesome CDN reachable |
| Buttons do nothing | Check console for JS errors (Ctrl+Shift+I) |
| Progress bar frozen | You paused—press Play again |

---
## ✉️ Support
For enhancements or backend wiring, create an issue or extend the code with modules (`/js`, `/assets`, etc.).

Enjoy building the full platform! 🚀

---
<!-- Redeploy trigger: $(date) -->
## 🔧 Fixing Failed GitHub Action: Missing `AZURE_STATIC_WEB_APPS_API_TOKEN`
If your GitHub Action run ("Azure Static Web Apps CI/CD") failed with an error like:

```
Error: Input required and not supplied: azure_static_web_apps_api_token
```

that means the deployment token secret isn’t set yet. Add it once and future pushes will deploy automatically.

### 1. Get the Deployment Token
1. In Azure Portal open your Static Web App resource.
2. Left menu: Settings (or Security) → Deployment token.
3. Click Copy.

### 2. Add GitHub Repository Secret
1. Open your repo on GitHub → Settings → Secrets and variables → Actions.
2. Click "New repository secret".
3. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
4. Value: (paste the token you copied)
5. Save.

### 3. Re-run the Workflow
Option A: On the failed workflow run page click "Re-run jobs".

Option B (trigger new run): Make a tiny commit and push:
```powershell
Add-Content -Path README.md -Value "`nRedeploy: $(Get-Date -Format o)"; git add README.md; git commit -m "chore: trigger redeploy"; git push
```

### 4. Verify Success
Open the new run → ensure the step "Deploy to Azure Static Web Apps" is green. Near the end of logs a URL like:

```
https://<random-name>.azurestaticapps.net
```

Test endpoints:
```
https://<random-name>.azurestaticapps.net/api/ping
https://<random-name>.azurestaticapps.net/api/quiz/sample
```

### 5. Common Pitfalls
| Symptom | Fix |
|---------|-----|
| Still missing token after adding | Secret name must be EXACT: `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| 401/403 Unauthorized | Regenerate token in portal and update secret |
| API 404 | Wait ~1–2 min (Functions cold start) or confirm `api/` deployed |
| Old workflow also present | Remove/rename extra auto-generated workflow to avoid double runs |

### 6. (Optional) Rotate Token
If compromised: Portal → Regenerate, update GitHub secret, re-run.

---
