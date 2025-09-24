param(
    [string]$StorageAccount,
    [string]$Container = "uploaded-docs",
    [string]$FileName = "sample-doc.txt",
    [string]$Content = "This is a sample KT onboarding document discussing architecture, components, and integration points." 
)

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { Write-Error "Azure CLI (az) not installed."; exit 1 }
if (-not $StorageAccount) { Write-Error "-StorageAccount required"; exit 1 }

$tmp = New-TemporaryFile
Set-Content -Path $tmp -Value $Content -Encoding UTF8
Write-Host "Uploading $FileName to $Container in $StorageAccount..."
az storage blob upload --account-name $StorageAccount -c $Container -f $tmp -n $FileName --only-show-errors
Remove-Item $tmp -Force
Write-Host "Uploaded. Blob trigger should fire shortly (cold start may take ~30s)."
