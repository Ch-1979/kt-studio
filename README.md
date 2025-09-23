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
```

### Option 5: Node.js Static Server (if you have Node)
```powershell
# One-time install (optional)
npm install -g serve
# Run
serve -p 5500 .
# Open http://localhost:5500
```

---
## 🧪 How to Validate It Works
1. Page loads with header, workspace banner, 3 columns, dark video panel, quiz card
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
