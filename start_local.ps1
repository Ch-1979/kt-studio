<#!
Helper PowerShell launcher for the KT Studio static UI.
It attempts (in order): python, py, node (npx http-server / serve), then falls back to opening index.html directly in Edge.
Usage: Right-click -> Run with PowerShell OR:
  PowerShell> ./start_local.ps1
#>

# Move to the script directory
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

$port = 5500
$index = Join-Path (Get-Location) 'index.html'

Write-Host "=== KT Studio Local Launcher ===" -ForegroundColor Cyan
Write-Host "Working directory: $(Get-Location)"

function Try-Command($test, $run, $label) {
    if (Get-Command $test -ErrorAction SilentlyContinue) {
        Write-Host "Starting server using $label..." -ForegroundColor Green
        Invoke-Expression $run
        exit 0
    }
}

# 1. Python (python)
Try-Command 'python' "python -m http.server $port" 'python'
# 2. Python launcher (py)
Try-Command 'py' "py -m http.server $port" 'py launcher'
# 3. Node http-server (if globally installed)
Try-Command 'http-server' "http-server -p $port" 'http-server (Node)'
# 4. Node + npx serve (auto download)
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "Attempting npx serve (this may download a package first)..." -ForegroundColor Yellow
    npx --yes serve -l $port .
    exit 0
}

function Start-EmbeddedServer {
    param(
        [int]$Port = 5500
    )
    Write-Warning "No external static server found. Starting minimal embedded PowerShell server on http://localhost:$Port" 
    try {
        Add-Type -AssemblyName System.Net.HttpListener -ErrorAction Stop
    } catch {
        Write-Error "Failed loading HttpListener. (This may be restricted by policy)."; return
    }
    $listener = New-Object System.Net.HttpListener
    $prefix = "http://localhost:$Port/"
    $listener.Prefixes.Add($prefix)
    try {
        $listener.Start()
    } catch {
        Write-Error "Could not start listener on $prefix. Try a different port (edit script)."; return
    }
    Write-Host "Serving $(Get-Location) at $prefix (Ctrl+C in this window to stop)" -ForegroundColor Green
    $edge = (Get-Command 'msedge' -ErrorAction SilentlyContinue)
    if ($edge) { Start-Process msedge $prefix } else { Start-Process $prefix }
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
        } catch { break }
        $localPath = $context.Request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($localPath)) { $localPath = 'index.html' }
        $fullPath = Join-Path (Get-Location) $localPath
        if (Test-Path $fullPath) {
            try {
                $bytes = [System.IO.File]::ReadAllBytes($fullPath)
                switch -regex ($fullPath) {
                    '\\.html$' { $context.Response.ContentType = 'text/html; charset=utf-8'; break }
                    '\\.css$'  { $context.Response.ContentType = 'text/css'; break }
                    '\\.js$'   { $context.Response.ContentType = 'application/javascript'; break }
                    '\\.svg$'  { $context.Response.ContentType = 'image/svg+xml'; break }
                    '\\.png$'  { $context.Response.ContentType = 'image/png'; break }
                    '\\.(jpg|jpeg)$' { $context.Response.ContentType = 'image/jpeg'; break }
                    default      { $context.Response.ContentType = 'application/octet-stream' }
                }
                $context.Response.StatusCode = 200
                $context.Response.OutputStream.Write($bytes,0,$bytes.Length)
            } catch {
                $msg = [Text.Encoding]::UTF8.GetBytes('500 - Error reading file')
                $context.Response.StatusCode = 500
                $context.Response.OutputStream.Write($msg,0,$msg.Length)
            }
        } else {
            $msg = [Text.Encoding]::UTF8.GetBytes('404 - Not Found')
            $context.Response.StatusCode = 404
            $context.Response.OutputStream.Write($msg,0,$msg.Length)
        }
        $context.Response.Close()
    }
}

# 5. Fallback: embedded server instead of raw file open (avoids Edge path misinterpretation)
Start-EmbeddedServer -Port $port
