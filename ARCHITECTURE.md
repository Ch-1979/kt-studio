# KT Studio AI Content Generation Architecture (Enhanced Version)

## Purpose
Transforms uploaded knowledge transfer documents into structured instructional video metadata (scenes + narration script + optional images) and adaptive quiz content using Azure OpenAI services.

## Current vs Enhanced
- Current: Deterministic fallback (paragraph split → scenes + simple quiz) – no AI, no media.
- Enhanced (this design): Multi‑stage Azure OpenAI powered pipeline producing:
  - Summaries & learning objectives
  - Structured scenes (title, script, key concepts, image prompts)
  - Quiz (difficulty, rationale, tags)
  - Optional AI images per scene (DALL·E / Azure OpenAI Image API)
  - Optional future narration (Azure AI Speech) + assembled slideshow video

## Azure Services
| Function | Service | Notes |
|----------|---------|-------|
| LLM reasoning (summary, scenes, quiz) | Azure OpenAI (GPT-4o / GPT-4o-mini) | JSON-constrained prompts |
| Image generation (per scene) | Azure OpenAI Images (DALL·E 3) | Store PNG in blob |
| (Optional) Narration | Azure AI Speech (Neural TTS) | SSML per scene |
| Storage of inputs/outputs | Azure Blob Storage | Containers: uploaded-docs, generated-videos, quiz-data, generated-images |
| Orchestration | .NET Azure Function (Blob Trigger) | Calls generator helpers |
| API surface (upload/status/fetch) | Python Functions in Static Web App | Stateless front door |

## Containers & Artifacts
| Container | Artifact Example | Description |
|-----------|------------------|-------------|
| uploaded-docs | demo1.txt | Raw user document |
| generated-videos | demo1.video.json | Scenes, summary, objectives, image/audio refs |
| quiz-data | demo1.quiz.json | Quiz questions metadata |
| generated-images | demo1/scene1.png | AI generated per-scene visuals |
| (future) media | demo1/final.mp4 | Rendered slideshow/video |

## video.json (Enhanced)
```
{
  "sourceDocument": "demo1.txt",
  "summary": "...",
  "learningObjectives": ["..."],
  "scenes": [
    {
      "index": 1,
      "title": "Architecture Overview",
      "script": "Narrative text...",
      "keyConcepts": ["scalability","pipeline"],
      "imagePrompt": "Professional diagram...",
      "imageBlob": "generated-images/demo1/scene1.png",
      "audioBlob": null
    }
  ],
  "modelMeta": {
    "summaryModel": "gpt-4o",
    "sceneModel": "gpt-4o",
    "quizModel": "gpt-4o-mini"
  },
  "createdUtc": "2025-09-25T12:34:56Z"
}
```

## quiz.json (Enhanced)
```
{
  "sourceDocument": "demo1.txt",
  "questions": [
    {
      "id": "q1",
      "stem": "Which component triggers processing?",
      "options": ["Frontend","Blob Trigger Function","User","Queue"],
      "correctIndex": 1,
      "difficulty": "easy",
      "rationale": "Blob trigger reacts to new uploads.",
      "tags": ["orchestration"]
    }
  ],
  "modelMeta": {"quizModel": "gpt-4o-mini"},
  "createdUtc": "..."
}
```

## Processing Stages
1. Ingest: Blob Trigger fires for uploaded-docs/{name}
2. Summarize & Objectives
3. Scene Generation (JSON with title/script/concepts + image prompts)
4. Quiz Generation
5. Image Generation (parallel per scene)
6. (Optional) Narration Generation (TTS)
7. Persist JSON & media
8. Status available to UI (implicit by blob existence now; can add status file later)

## Environment Variables
| Key | Purpose |
|-----|---------|
| AZURE_OPENAI_ENDPOINT | Base endpoint (e.g. https://my-openai-resource.openai.azure.com) |
| AZURE_OPENAI_KEY | API key (or use Managed Identity) |
| AZURE_OPENAI_DEPLOYMENT_SUMMARY | Deployment name for summarization model (e.g. gpt-4o) |
| AZURE_OPENAI_DEPLOYMENT_SCENE | Deployment name for scene generation |
| AZURE_OPENAI_DEPLOYMENT_QUIZ | Deployment name for quiz generation (can be smaller) |
| AZURE_OPENAI_IMAGE_DEPLOYMENT | Image model deployment (e.g. dalle3) |
| MAX_SCENES | Cap scenes (default 6–8) |
| ENABLE_IMAGE_GEN | true/false toggle |
| ENABLE_TTS | true/false for future narration |
| FALLBACK_ONLY | If true, skip all AI and use deterministic path |

## Prompt Strategies (Condensed)
- Summary Prompt: "Summarize the document in <= 160 words and extract 3–5 learning objectives as JSON: {summary:string, objectives:string[]}"
- Scenes Prompt: Provide summary + objectives + truncated source; ask for JSON: { scenes:[ { title, script, keyConcepts[], imagePrompt } ] } respecting MAX_SCENES and <= 120 words script.
- Quiz Prompt: Provide scenes & objectives; request JSON: { questions:[ { id, stem, options[], correctIndex, difficulty, rationale, tags[] } ] }
- Image Prompt (per scene): Combine scene title + key concepts + stylistic descriptor; ensure safe, brand-aligned output.

## Error Handling & Fallback
- If any AI step fails → log, revert to deterministic fallback for all outputs (consistency > partial AI mix).
- JSON extraction: parse first/last brace; retry once with "Return ONLY valid JSON" message.
- Image generation failure: store null imageBlob; frontend uses placeholder.

## Scaling & Concurrency
- Blob Trigger is idempotent per document name.
- Add ETag check if reprocessing allowed.
- Potential queue fan-out for image generation if high volume.

## Security
- No external calls except Azure OpenAI & (future) Speech.
- Avoid injecting raw user text into prompts without minimal sanitation (strip secrets if policy required).
- Consider content filtering for compliance.

## Roadmap
Phase | Feature
------|--------
1 | (Done) Deterministic baseline
2 | (This) Azure OpenAI integration (summary, scenes, quiz, images)
3 | Status JSON + progress tracking
4 | Speech narration + slideshow assembly
5 | Retrieval grounding (Azure AI Search) for large docs
6 | Advanced analytics (engagement, quiz adaptivity)

## Frontend Impact
- Add optional image display per scene.
- Add placeholder if imageBlob missing.
- Show modelMeta tooltip (transparency).

## Summary
This enhanced architecture enables rich AI-generated instructional content while preserving a deterministic fallback. Modularity allows incremental adoption of media (images, narration, video) without reworking ingestion or UI contracts.
