# LLM-Orchestrated Storyboard Pipeline

## Overview
This document describes the production prompt-generation pipeline introduced in October 2025. The Azure Functions backend now processes every uploaded document end-to-end through Azure OpenAI. There are no deterministic fallbacks; if the document cannot be extracted or the LLM cannot produce compliant JSON, processing fails fast and surfaces the error in logs.

## High-Level Flow
1. **Blob Trigger / Manual Invocation** – `ProcessKTDocument` reacts to uploads or on-demand replays.
2. **Document Extraction** – `DocumentContentExtractor` normalizes the uploaded payload, detects binary files, splits it into ~3.5k-character segments, and records word/token counts.
3. **Generation Spec** – Word count drives target scene/quiz counts (3–6 scenes, 3–6 quiz questions).
4. **LLM Orchestration** – `GenerateStoryboardWithAzureOpenAi` sends the full segmented document to Azure OpenAI (chat completions with JSON schema enforcement). The system message requires:
   - exact scene/quiz counts
   - non-empty narration and `visualPrompt`
   - explicit error JSON if the document cannot be honored
5. **Validation** – `ValidateGenerationResult` ensures summary, scenes, and quiz items are present, counts match the spec, each scene has a `visualPrompt`, and each quiz has exactly four options. Any violation raises `StoryboardGenerationException`.
6. **Style Application** – `DetermineVideoStyle` plus `SceneData.ApplyStyle` enrich scene prompts with motion/lighting cues without overriding the LLM’s context.
7. **Video Submission** – `GenerateVideoAssetAsync` packages the cinematic instructions and submits the prompt to Azure OpenAI Video (Sora-compatible preview API). The selected style metadata is persisted in the manifest.
8. **Artifacts** – On success, the function writes `{document}.video.json` and `{document}.quiz.json`. On failure, the Azure Function run fails (no JSON emitted), prompting investigation.

## Key Components
| Component | Responsibility |
|-----------|----------------|
| `DocumentContentExtractor` | Validates text payloads, collapses whitespace, segments into LLM-sized chunks, and emits metadata for logging. Detects binary/unsupported formats and throws. |
| `GenerateStoryboardWithAzureOpenAi` | Constructs the chat payload, sends the complete document (segmented) to the configured deployment, and throws on any HTTP or schema failure. |
| `ValidateGenerationResult` | Applies business rules to the parsed JSON to guarantee fully-populated scenes and quiz items. |
| `SceneData.ApplyStyle` | Augments LLM-provided `visualPrompt` strings with the selected cinematic style without introducing fallbacks. |
| `VideoAsset.Success` | Captures prompt + style telemetry for downstream observability.

## Error Handling
- **Extraction problems** (`DocumentExtractionException`) – raised when the document is empty, binary, or otherwise unreadable. Logged and rethrown; the Azure Function invocation fails.
- **LLM failures** (`StoryboardGenerationException`) – include HTTP errors, invalid JSON, missing fields, or count mismatches. These stop processing; no deterministic prompts are produced.
- **Video generation issues** (`VideoGenerationException`) – handled separately when Sora/video preview returns issues; manifests record the error while preserving storyboard outputs.

## Telemetry
- Extraction logs: document name, word count, segment count, estimated tokens.
- LLM submission logs: deployment name, payload length, request duration.
- Validation logs: scene/quiz counts post-validation.
- Style logs: chosen visual style, motion, lighting, and avoid directives.

## Configuration Checklist
| Setting | Description |
|---------|-------------|
| `AzureOpenAI__Endpoint` / `AzureOpenAI__ApiKey` | Base endpoint + API key for Azure OpenAI. |
| `AzureOpenAI__Deployment` | Deployment name for the chat model returning storyboard JSON. |
| `AzureOpenAI__ImageDeployment` | Optional image model for per-scene thumbnail generation. |
| `AzureOpenAI__VideoDeployment` | Sora-compatible video generation deployment. |
| `AzureWebJobsStorage` | Connection string for blob storage.

All three OpenAI settings must be present; missing values now raise `StoryboardGenerationException` and prevent fallback behavior.

## Prompt Structure
- **System message** – Sets the contract (exact counts, JSON schema, explicit error JSON on failure).
- **User message** – Provides document metadata plus every segment in order, bounded by `--- SEGMENT n START/END ---`, and reiterates the contract to avoid markdown wrappers.

## Validation Rules
1. Summary must be non-empty.
2. Scene count ≥ target and each scene includes populated `title`, `narration`, and `visualPrompt`.
3. Quiz count ≥ target with exactly four options per question.
4. Any schema deviation results in immediate failure; there is no retry with deterministic prompts.

## Deployment Notes
- The build marker `RebindMarker_2025-10-02T09:55Z` forces Azure to pick up deployments.
- Without the .NET SDK locally, run builds via CI to ensure type safety.
- Monitor Application Insights for the new error classes to track extraction vs. LLM failures.

## Future Enhancements
- Support for PDF/DOCX extraction via Azure Document Intelligence (current release stops at detection).
- Streaming chunk summarization to reduce token footprint for extremely long documents.
- Automatic retries with alternative instructions before failing, while still avoiding deterministic fallbacks.
