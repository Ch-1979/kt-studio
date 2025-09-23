<#!
Switch Git repository to a different GitHub account.
Usage examples:
  # Set local repo to new account details and change remote
  ./switch_git_account.ps1 -UserName "new-user" -Email "newuser@example.com" -Repo "new-repo-name" -CreateRemote -UseHTTPS

  # Just change author identity
  ./switch_git_account.ps1 -UserName "new-user" -Email "newuser@example.com"

Optional parameters:
 -Pat     Provide a GitHub Personal Access Token to set a one-off remote URL with embedded token (NOT stored).
 -SSH     Use SSH remote instead of HTTPS (assumes you have uploaded your public key to that GitHub account).

NOTE: If the repo has not been initialized yet, pass -Init to run git init automatically.
#>
param(
    [string]$UserName,
    [string]$Email,
    [string]$Repo,               # New repository name (only used if -CreateRemote specified)
    [string]$OrgOrUser,          # GitHub org/user (defaults to $UserName if empty)
    [switch]$CreateRemote,
    [switch]$UseHTTPS,
    [switch]$SSH,
    [string]$Pat,                # Personal Access Token (classic or fine-grained) for HTTPS embedding (one-time)
    [switch]$Init,
    [switch]$ShowConfig
)

function Write-Info($msg){ Write-Host $msg -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host $msg -ForegroundColor Red }

if ($Init) {
    if (-not (Test-Path .git)) {
        Write-Info "Initializing new git repository..."
        git init | Out-Null
    } else {
        Write-Warn ".git already exists. Skipping init."
    }
}

if ($UserName) {
    Write-Info "Setting local user.name -> $UserName"
    git config user.name $UserName
}
if ($Email) {
    Write-Info "Setting local user.email -> $Email"
    git config user.email $Email
}

if ($ShowConfig) {
    Write-Info "Current local git config:"
    git config --list --local
}

if ($CreateRemote) {
    if (-not $Repo) { Write-Err "-Repo is required with -CreateRemote"; exit 1 }
    if (-not $OrgOrUser) { $OrgOrUser = $UserName }

    $remoteName = "origin"

    if ($SSH) {
        $remoteUrl = "git@github.com:$OrgOrUser/$Repo.git"
    } elseif ($UseHTTPS) {
        if ($Pat) {
            $remoteUrl = "https://$Pat@github.com/$OrgOrUser/$Repo.git"
            Write-Warn "Embedding PAT in remote URL (one-time). It won't be stored if you later set a clean URL. Consider using credential manager instead."
        } else {
            $remoteUrl = "https://github.com/$OrgOrUser/$Repo.git"
        }
    } else {
        $remoteUrl = "https://github.com/$OrgOrUser/$Repo.git"
    }

    if (git remote get-url $remoteName 2>$null) {
        Write-Warn "Remote '$remoteName' exists. Updating URL -> $remoteUrl"
        git remote set-url $remoteName $remoteUrl
    } else {
        Write-Info "Adding remote '$remoteName' -> $remoteUrl"
        git remote add $remoteName $remoteUrl
    }

    Write-Info "Remote now points to:"
    git remote -v
}

Write-Info "Done. Next steps (if new repo):"
Write-Host "  git add ." -ForegroundColor Green
Write-Host "  git commit -m 'Initial commit'" -ForegroundColor Green
Write-Host "  git push -u origin main" -ForegroundColor Green
