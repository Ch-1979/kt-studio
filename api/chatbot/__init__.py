import json
import logging
import os
from textwrap import shorten

import azure.functions as func  # type: ignore
import requests

from ..shared_blob import generate_stub_video, load_processed_quiz, load_processed_video

DEFAULT_API_VERSION = "2024-08-01-preview"


def _get_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def _load_context(doc_name: str) -> tuple[dict, dict]:
    video = load_processed_video(doc_name) or generate_stub_video(doc_name)
    quiz = load_processed_quiz(doc_name) or {"questions": []}
    return video or {}, quiz or {}


def _build_context_text(video: dict, quiz: dict, max_chars: int = 6000) -> str:
    parts: list[str] = []
    if summary := video.get("summary"):
        parts.append(f"Summary: {summary}")

    scenes = video.get("scenes") or []
    formatted_scenes: list[str] = []
    for scene in scenes[:6]:
        title = scene.get("title") or scene.get("heading") or "Scene"
        text = scene.get("text") or scene.get("narration") or ""
        formatted_scenes.append(f"- {title}: {text}")
    if formatted_scenes:
        parts.append("Scenes:\n" + "\n".join(formatted_scenes))

    questions = quiz.get("questions") or []
    formatted_questions: list[str] = []
    for question in questions[:5]:
        q_text = question.get("text") or question.get("question")
        options = question.get("options") or []
        answer_idx = question.get("correctIndex", 0)
        answer = None
        if isinstance(options, list) and 0 <= answer_idx < len(options):
            answer = options[answer_idx]
        formatted_questions.append(
            "Q: " + (q_text or "") + (f"\nA: {answer}" if answer else "")
        )
    if formatted_questions:
        parts.append("Quiz insights:\n" + "\n".join(formatted_questions))

    context = "\n\n".join(parts) if parts else "No context available."
    return shorten(context, width=max_chars, placeholder="\n…")


def _call_azure_openai(question: str, context: str) -> str | None:
    endpoint = _get_env("AzureOpenAI:Endpoint", "AzureOpenAI__Endpoint", "AZURE_OPENAI_ENDPOINT")
    api_key = _get_env("AzureOpenAI:ApiKey", "AzureOpenAI__ApiKey", "AZURE_OPENAI_KEY")
    deployment = _get_env(
        "AzureOpenAI:ChatDeployment",
        "AzureOpenAI__ChatDeployment",
        "AzureOpenAI:Deployment",
        "AzureOpenAI__Deployment",
        "AZURE_OPENAI_DEPLOYMENT",
    )
    api_version = _get_env("AzureOpenAI:ApiVersion", "AzureOpenAI__ApiVersion", "AZURE_OPENAI_API_VERSION") or DEFAULT_API_VERSION

    if not endpoint or not api_key or not deployment:
        logging.warning("[chatbot] Missing Azure OpenAI configuration.")
        return None

    base_uri = endpoint.rstrip("/")
    url = f"{base_uri}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"

    payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a helpful Q&A assistant for knowledge transfer content. "
                    "Answer using the provided context. If the answer is not in the context, say you do not know."
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n---\nQuestion: {question}\nAnswer concisely in 3-4 sentences.",
            },
        ],
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": 400,
    }

    headers = {
        "Content-Type": "application/json",
        "api-key": api_key,
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code >= 400:
            logging.warning("[chatbot] Azure OpenAI error %s: %s", response.status_code, response.text[:200])
            return None
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            return None
        message = choices[0].get("message", {}).get("content")
        return message
    except requests.RequestException as exc:
        logging.warning("[chatbot] Azure OpenAI request failed: %s", exc)
        return None


def _format_sources(video: dict) -> list[dict]:
    sources = []
    scenes = video.get("scenes") or []
    for scene in scenes[:3]:
        sources.append(
            {
                "title": scene.get("title") or "Scene",
                "snippet": scene.get("text") or scene.get("narration") or "",
            }
        )
    if not sources and video.get("summary"):
        sources.append({"title": "Summary", "snippet": video["summary"]})
    return sources


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON payload."}), status_code=400, mimetype="application/json"
        )

    question = (body.get("question") or body.get("message") or "").strip()
    doc_name = (body.get("docName") or body.get("doc") or body.get("document"))
    if isinstance(doc_name, str):
        doc_name = doc_name.strip()

    if not question:
        return func.HttpResponse(
            json.dumps({"error": "Question is required."}), status_code=400, mimetype="application/json"
        )
    if not doc_name:
        return func.HttpResponse(
            json.dumps({"error": "docName is required."}), status_code=400, mimetype="application/json"
        )

    video, quiz = _load_context(doc_name)
    context = _build_context_text(video, quiz)
    answer = _call_azure_openai(question, context)

    if not answer:
        fallback = video.get("summary") or "I couldn't retrieve enough context to answer that."
        answer = (
            "I wasn't able to reach the AI service right now, but here's what the storyboard summary says:\n"
            f"{fallback}"
        )

    payload = {
        "answer": answer,
        "sources": _format_sources(video),
    }

    return func.HttpResponse(json.dumps(payload), status_code=200, mimetype="application/json")
