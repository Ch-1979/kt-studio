# C# Azure Functions: ProcessKTDocument

This project contains a .NET 8 isolated worker Azure Functions app with a Blob Trigger function `ProcessKTDocument` that transforms an uploaded KT document into structured artifacts (summary, scenes, quiz, audio references).

## Function Overview
Trigger: Blob upload to container `uploaded-docs` (storage linked by `AzureWebJobsStorage`).

Pipeline steps:
1. Read original document text
2. Call Azure OpenAI to produce: summary, structured storyboard scenes, and quiz questions
3. Each scene now carries a `visualPrompt` that requests a clean technical architecture or workflow diagram aligned with the source content.
4. Optionally call Azure OpenAI image generation to create a visual for each scene (stored in `storyboard-images`)
5. Store video JSON (including scene metadata + image URLs) in `generated-videos`
6. Store quiz JSON in `quiz-data`

All containers are auto-created if missing (private access).

## Project Structure
- `ProcessKTDocumentFunction.csproj` – Project file & NuGet dependencies
- `Program.cs` – Host + DI registration (OpenAI client, Blob service)
- `ProcessKTDocument.cs` – Core function logic
- `host.json` – Functions host configuration
- `local.settings.json` – Local development settings (DO NOT COMMIT real secrets)

## Required Settings (local.settings.json)
```
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "AzureOpenAI:Endpoint": "https://YOUR_OPENAI_RESOURCE.openai.azure.com/",
    "AzureOpenAI:ApiKey": "YOUR_OPENAI_KEY",
    "AzureOpenAI:Deployment": "gpt-4o-mini",
    "AzureOpenAI:ImageDeployment": "gpt-image-1"
  }
}
```

Replace the placeholder values with real keys from Azure Portal.

> ℹ️ **Image deployments:** Set `AzureOpenAI:ImageDeployment` to the name of your Azure OpenAI image model (for example `gpt-image-1` or `dall-e-3`). DALL·E 3 in Azure runs as an asynchronous job; the function now submits the request and polls until the operation finishes. Azure currently supports square or cinematic aspect ratios (for example `1024x1024` or `1792x1024`).

## Running Locally
Prerequisites: .NET 8 SDK, Azure Storage Emulator (Azurite) or real storage account.

1. Start Azurite (if using local): In another terminal run `azurite` (npm install -g azurite if needed)
2. From this folder:
```
dotnet build
func start
```
(Install Azure Functions Core Tools if `func` not found.)

Upload a test blob:
```
# Example (PowerShell)
Set-Content -Path sample.txt -Value "This is a sample KT document about onboarding."
$env:AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
az storage blob upload -c uploaded-docs -f sample.txt -n sample.txt --account-name devstoreaccount1 --account-key  Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==
```
(Above key is the well-known Azurite development key.)

## Deployment Notes
- Add these app settings in Azure Function App or Static Web App API configuration.
- Ensure the storage connection string is set (`AzureWebJobsStorage`).
- Grant network access for Azure OpenAI endpoints if using private networking.

## Extending
- Add Cosmos DB or Table Storage for persistence of processing status
- Introduce Durable Functions to orchestrate long-running generation
- Add retry logic & circuit breaker for OpenAI calls

## Disclaimer
This is an MVP scaffold with minimal error handling; enhance logging, validation, and security for production.
