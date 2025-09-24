param(
    [string]$ResourceGroup = "rg-kt-studio-dev",
    [string]$Location = "eastus",
    [string]$FunctionAppName = "ktstudio-csharp-func",
    [string]$StorageAccount = "",
    [switch]$CreateRg,
    [switch]$SkipPublish
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

Write-Host "Done. Configure AzureOpenAI & Speech settings separately:" -ForegroundColor Cyan
Write-Host "az functionapp config appsettings set -g $ResourceGroup -n $FunctionAppName --settings AzureOpenAI:Endpoint=... AzureOpenAI:ApiKey=... AzureOpenAI:Deployment=... Speech:ApiKey=... Speech:Region=... Speech:Voice=en-US-JennyNeural" -ForegroundColor DarkGray
