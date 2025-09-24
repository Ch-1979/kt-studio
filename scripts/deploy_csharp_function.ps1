param(
    [string]$ResourceGroup = "rg-kt-studio-dev",
    [string]$Location = "eastus",
    [string]$FunctionAppName = "ktstudio-csharp-func",
    [string]$StorageAccount = "",
    [switch]$CreateRg,
    [switch]$SkipPublish,
    # Optional OpenAI
    [string]$OpenAIEndpoint = "",
    [string]$OpenAIKey = "",
    [string]$OpenAIDeployment = "gpt-4o-mini",
    # Optional Speech
    [string]$SpeechKey = "",
    [string]$SpeechRegion = "",
    [string]$SpeechVoice = "en-US-JennyNeural",
    # Ensure containers
    [switch]$EnsureContainers
)

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Error "Azure CLI (az) not found. Install from https://aka.ms/installazurecliwindows"; exit 1
}

if (-not $StorageAccount) { Write-Error "-StorageAccount is required"; exit 1 }

if ($CreateRg) {
    az group create -n $ResourceGroup -l $Location | Out-Null
}

# Check if function app exists
$exists = az functionapp show -g $ResourceGroup -n $FunctionAppName 2>$null | ConvertFrom-Json
if (-not $exists) {
    Write-Host "Creating Function App $FunctionAppName in $ResourceGroup..."
    az functionapp create `
        --resource-group $ResourceGroup `
        --consumption-plan-location $Location `
        --runtime dotnet-isolated `
        --functions-version 4 `
        --name $FunctionAppName `
        --storage-account $StorageAccount | Out-Null
}
else {
    Write-Host "Function App already exists; continuing with deployment" -ForegroundColor Yellow
}

Write-Host "Publishing project (dotnet publish)..."
$publishDir = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'csharp-functions/publish'
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
& dotnet publish (Join-Path $PSScriptRoot '../csharp-functions/ProcessKTDocumentFunction.csproj') -c Release -o $publishDir | Out-Null

if (-not $SkipPublish) {
    if (-not (Get-Command func -ErrorAction SilentlyContinue)) {
        Write-Error "Azure Functions Core Tools (func) not found. Install: https://learn.microsoft.com/azure/azure-functions/functions-run-local"; exit 1
    }
    Write-Host "Deploying with Functions Core Tools..."
    Push-Location $publishDir
    func azure functionapp publish $FunctionAppName --dotnet-isolated | Out-Host
    Pop-Location
}

Write-Host "Setting recommended app settings..."
az functionapp config appsettings set -g $ResourceGroup -n $FunctionAppName --settings `
  FUNCTIONS_WORKER_RUNTIME=dotnet-isolated `
  WEBSITE_RUN_FROM_PACKAGE=1 | Out-Null

# Append optional AI settings if provided
$appSettings = @{}
if ($OpenAIEndpoint -and $OpenAIKey) {
    $appSettings['AzureOpenAI:Endpoint'] = $OpenAIEndpoint
    $appSettings['AzureOpenAI:ApiKey'] = $OpenAIKey
    if ($OpenAIDeployment) { $appSettings['AzureOpenAI:Deployment'] = $OpenAIDeployment }
}
if ($SpeechKey -and $SpeechRegion) {
    $appSettings['Speech:ApiKey'] = $SpeechKey
    $appSettings['Speech:Region'] = $SpeechRegion
    if ($SpeechVoice) { $appSettings['Speech:Voice'] = $SpeechVoice }
}
if ($appSettings.Count -gt 0) {
    $settingsArgs = $appSettings.GetEnumerator() | ForEach-Object { $_.Name + '=' + $_.Value }
    az functionapp config appsettings set -g $ResourceGroup -n $FunctionAppName --settings $settingsArgs | Out-Null
    Write-Host "Applied OpenAI/Speech settings" -ForegroundColor Green
} else {
    Write-Host "(No OpenAI/Speech settings provided, fallback content will be used)" -ForegroundColor Yellow
}

if ($EnsureContainers) {
    Write-Host "Ensuring blob containers exist..."
    foreach ($c in 'uploaded-docs','generated-audio','generated-videos','quiz-data') {
        az storage container create --name $c --account-name $StorageAccount --output none 2>$null
    }
    Write-Host "Containers ensured." -ForegroundColor Green
}

Write-Host "Done." -ForegroundColor Cyan
Write-Host "Blob trigger deployment complete -> Function App: $FunctionAppName" -ForegroundColor Cyan
Write-Host "If you did not pass keys, you can add them later with: az functionapp config appsettings set -g $ResourceGroup -n $FunctionAppName --settings AzureOpenAI:Endpoint=... AzureOpenAI:ApiKey=..." -ForegroundColor DarkGray
