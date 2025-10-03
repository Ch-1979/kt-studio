from __future__ import annotations

import json
import os
import traceback
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import azure.functions as func  # type: ignore
import requests

from ..shared_blob import load_processed_quiz, load_processed_video

DEFAULT_API_VERSION = "2024-08-01-preview"
MAX_CONTEXT_CHARACTERS = 6000
MAX_SCENES = 8
ALLOWED_ORIGIN = os.getenv("CHATBOT_ALLOW_ORIGIN", "*")


@dataclass
class ChatConfig:
    endpoint: str
    key: str
    deployment: str
    api_version: str

    @classmethod
    def from_env(cls) -> "ChatConfig":
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or os.getenv("AZURE_OPENAI__ENDPOINT")
        key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("AZURE_OPENAI__API_KEY")
        deployment = (
            os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI__CHAT_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI__DEPLOYMENT")
        )
        api_version = os.getenv("AZURE_OPENAI_API_VERSION") or DEFAULT_API_VERSION
        if not endpoint or not key or not deployment:
            raise RuntimeError("Azure OpenAI environment variables are not configured.")
        return cls(endpoint.rstrip("/"), key, deployment, api_version)


def _cors_response(status: int = 200, body: str = "") -> func.HttpResponse:  # type: ignore
    return func.HttpResponse(
        body,
        status_code=status,
        headers={
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "content-type,x-functions-key",
        },
        mimetype="application/json" if body else None,
    )


def handle_request(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    if req.method.upper() == "OPTIONS":
        return _cors_response()
    if req.method.upper() != "POST":
        return _cors_response(405, json.dumps({"error": "Only POST supported"}))

    try:
        payload = req.get_json()  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        payload = {}

    doc_name = (payload.get("docName") or payload.get("document")) if isinstance(payload, dict) else None
    question = (payload.get("question") or payload.get("prompt")) if isinstance(payload, dict) else None
    history = payload.get("history") if isinstance(payload, dict) else None

    if not doc_name:
        return _cors_response(400, json.dumps({"error": "Missing docName"}))
    if not question or not isinstance(question, str):
        return _cors_response(400, json.dumps({"error": "Missing question"}))

    try:
        config = ChatConfig.from_env()
    except RuntimeError as exc:  # pragma: no cover - configuration errors are runtime issues
        return _cors_response(503, json.dumps({"error": str(exc)}))

    try:
        video_json = load_processed_video(doc_name)
        if not video_json:
            return _cors_response(404, json.dumps({"error": f"No processed video manifest found for {doc_name}"}))

        quiz_json = load_processed_quiz(doc_name)

        context_block = _build_context(video_json, quiz_json)
        if not context_block:
            return _cors_response(500, json.dumps({"error": "Unable to build context for chat"}))

        chat_messages = _build_messages(question, context_block, history)

        answer, usage, error_details = _invoke_chat_completion(config, chat_messages)
        if answer is None:
            payload = {"error": "Chat completion request failed"}
            if error_details:
                payload["details"] = error_details
            return _cors_response(502, json.dumps(payload))

        response_body = {
            "answer": answer.strip(),
            "docName": doc_name,
            "usage": usage,
        }
        return _cors_response(200, json.dumps(response_body))
    except Exception as exc:  # pragma: no cover - defensive catch for production visibility
        trace = traceback.format_exc(limit=6)
        print(f"[chatbot] Unhandled exception: {exc}\n{trace}")
        return _cors_response(500, json.dumps({"error": str(exc), "trace": trace}))


def _build_context(video_json: Dict[str, Any], quiz_json: Optional[Dict[str, Any]]) -> str:
    lines: List[str] = []
    summary = (video_json.get("summary") or "").strip()
    if summary:
        lines.append("Document Summary:\n" + summary)

    scenes = video_json.get("scenes")
    if isinstance(scenes, list) and scenes:
        lines.append("Key Scenes:")
        for scene in scenes[:MAX_SCENES]:
            title = (scene.get("title") or scene.get("badge") or f"Scene {scene.get('index', '')}").strip()
            text = (scene.get("text") or scene.get("narration") or "").strip()
            if not text:
                continue
            lines.append(f"- {title}: {text}")

    if quiz_json and isinstance(quiz_json.get("questions"), list):
        qa_lines = []
        for item in quiz_json["questions"][:3]:
            stem = item.get("text") or item.get("question")
            options = item.get("options") or []
            answer_index = item.get("correctIndex")
            if stem and options and isinstance(answer_index, int) and 0 <= answer_index < len(options):
                qa_lines.append(f"Q: {stem}\nA: {options[answer_index]}")
        if qa_lines:
            lines.append("Sample Quiz Knowledge:")
            lines.extend(qa_lines)

    context = "\n\n".join(lines).strip()
    return context[:MAX_CONTEXT_CHARACTERS]


def _build_messages(question: str, context_block: str, history: Optional[Iterable[Dict[str, Any]]]) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = []
    system_prompt = (
        "You are \"Hello, I'm Q&A bot – ask me anything\", an upbeat assistant that answers questions about "
        "enterprise knowledge transfer documents. Use only the context provided. If the context does not contain "
        "the answer, say you do not know. Keep answers precise (2-4 sentences) and cite scene titles when relevant."
    )
    messages.append({"role": "system", "content": system_prompt})

    if history:
        for entry in history:
            if not isinstance(entry, dict):
                continue
            role = entry.get("role")
            content = entry.get("content")
            if role in {"user", "assistant", "system"} and isinstance(content, str) and content.strip():
                messages.append({"role": role, "content": content.strip()})

    prompt = (
        "Context:\n" + context_block + "\n\n" +
        "Question: " + question.strip() + "\n\n" +
        "Answer strictly from the context. If you reference a scene, include its title in parentheses."
    )
    messages.append({"role": "user", "content": prompt})
    return messages


def _invoke_chat_completion(
    config: ChatConfig, messages: List[Dict[str, str]]
) -> Tuple[Optional[str], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    url = f"{config.endpoint}/openai/deployments/{config.deployment}/chat/completions"
    params = {"api-version": config.api_version}
    payload = {
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 600,
    }
    headers = {
        "Content-Type": "application/json",
        "api-key": config.key,
    }

    response_text = ""
    try:
        response = requests.post(url, params=params, headers=headers, json=payload, timeout=30)
        response_text = response.text
        if response.status_code >= 400:
            snippet = response_text[:800]
            print(f"[chatbot] Azure OpenAI call failed: {response.status_code} {snippet}")
            return None, None, {"status": response.status_code, "response": snippet}
        data = response.json()
    except requests.RequestException as exc:  # pragma: no cover - network errors
        print(f"[chatbot] Azure OpenAI request exception: {exc}")
        return None, None, {"message": str(exc)}
    except ValueError:
        snippet = response_text[:800]
        print("[chatbot] Failed to decode Azure OpenAI response JSON")
        return None, None, {"message": "Invalid JSON from Azure OpenAI", "response": snippet}

    choices = data.get("choices") if isinstance(data, dict) else None
    if not choices:
        return None, data.get("usage") if isinstance(data, dict) else None, {"message": "No choices in response"}

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):  # new SDK style may return list of text chunks
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    usage = data.get("usage") if isinstance(data, dict) else None
    return (content or None), usage, None
