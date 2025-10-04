# Storyboard Generation Pipeline

## Overview
`ProcessKTDocument` is a .NET 8 isolated Azure Function that reacts to new blobs in `uploaded-docs` and produces two JSON artifacts:

- `<doc>.video.json` – contains the document summary plus a list of scenes (title, narration, keywords, optional artwork links).
- `<doc>.quiz.json` – multiple-choice questions with correct answers and explanations when available.

The implementation favors resiliency: if Azure OpenAI cannot return compliant JSON, the function falls back to a heuristic summarizer so the frontend still receives a usable storyboard and quiz.

## Flow Summary
1. **Trigger** – Blob upload (or manual requeue via the Python API).
2. **Document read** – The blob body is retrieved as UTF‑8 text.
3. **LLM request** – If `AzureOpenAI:Endpoint`, `:ApiKey`, and `:Deployment` are configured, the function calls the chat completion API with a JSON-schema constrained prompt.
4. **Fallback** – When the LLM call fails or returns unusable data, a deterministic fallback builds three scenes and baseline quiz questions from the document text.
5. **Scene imagery (optional)** – If `AzureOpenAI:ImageDeployment` is set, each scene receives a prompt for image generation (DALL·E 3 / `gpt-image-1`). The resulting PNGs are stored in `storyboard-images` with SAS URLs returned in the manifest.
6. **Persistence** – Storyboard JSON is written to `generated-videos`; quiz JSON goes to `quiz-data`.

## Key Types
| Type | Purpose |
|------|---------|
| `GenerationResult` | Maps the Azure OpenAI response (`summary`, `scenes`, `quiz`). |
| `SceneData` | Normalizes scene attributes, guesses keywords, handles fallback prompt creation. |
| `QuizQuestion` | Ensures four options per question and clamps the correct answer index. |

## Error Handling & Logging
- Azure OpenAI failures are logged and trigger fallback generation instead of failing the run.
- Image generation issues are logged per scene but do not abort processing.
- Any unhandled exception is logged and rethrown so the Functions runtime records a failed invocation.

## Configuration Checklist
| Setting | Description |
|---------|-------------|
| `AzureOpenAI:Endpoint` / `AzureOpenAI__Endpoint` | Base endpoint for Azure OpenAI. |
| `AzureOpenAI:ApiKey` / `AzureOpenAI__ApiKey` | API key for the chosen resource. |
| `AzureOpenAI:Deployment` / `AzureOpenAI__Deployment` | Chat model that returns storyboard JSON. |
| `AzureOpenAI:ImageDeployment` / `AzureOpenAI__ImageDeployment` | Optional image model name. |
| `AzureWebJobsStorage` | Storage connection string shared with the blob trigger. |

Only the chat deployment is required; image generation is optional.

## Prompt Structure
- **System message** – Directs the model to act as an Azure learning consultant and to emit JSON following the supplied schema.
- **User message** – Wraps the truncated document content between `SOURCE DOCUMENT BEGIN/END` markers.
- **Response format** – Uses `json_schema` to enforce a predictable contract.

## Fallback Heuristics
When no valid LLM response is available, the function:
- Extracts up to five distinct paragraphs longer than 25 characters.
- Uses the first paragraph to craft the summary.
- Builds scenes by titling and tagging each paragraph.
- Emits three quiz questions (topic, count of major concepts, Azure service powering the storyboard).

## Future Enhancements
- Swap the naïve text extraction with Azure Document Intelligence for richer PDFs/DOCX files.
- Persist processing metadata (timestamps, failure reasons) for observability.
- Allow configurable target scene counts per document type.
- Add automated replays when the LLM response fails validation instead of falling back immediately.
