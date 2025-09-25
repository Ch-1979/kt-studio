"""Shared blob/storage helper functions for the Functions API.

This file was apparently emptied, which made any import like
`from ..shared_blob import save_uploaded_text` fail at runtime and
caused the upload endpoint to return HTTP 500. We recreate a minimal
implementation that:

* Saves uploaded text (or placeholder text) into a blob container.
* Provides light stubs for future video / quiz generation.
* Gracefully degrades to in-memory/local fallback if Azure storage
  is not configured (still letting the API respond 200 so the UI flow
  can continue in dev).

Environment expectations (Functions runtime automatically provides
AzureWebJobsStorage). For local dev you can use the Azurite emulator
or a real connection string.
"""

from __future__ import annotations

import os
import json
import datetime as _dt
from typing import List, Dict, Any, Optional, Tuple

try:  # Import optional blob packages; they are present in requirements.txt
	from azure.storage.blob import BlobServiceClient  # type: ignore
except Exception:  # pragma: no cover - If not available we fall back
	BlobServiceClient = None  # type: ignore

UPLOAD_CONTAINER = "uploaded-docs"
VIDEO_CONTAINER = "generated-videos"
QUIZ_CONTAINER = "quiz-data"

_IN_MEMORY_STORE: dict[str, str] = {}


def _get_connection_string() -> Optional[str]:
	"""Return a connection string if any known env var is set.

	We support multiple variable names for resiliency:
	  * AzureWebJobsStorage (standard for Functions / SWA)
	  * AZURE_STORAGE_CONNECTION_STRING (common custom)
	  * BLOB_CONNECTION_STRING / blob_connection_string (user provided)
	Returns the first non-empty one.
	"""
	for key in [
		"AzureWebJobsStorage",
		"AZURE_STORAGE_CONNECTION_STRING",
		"BLOB_CONNECTION_STRING",
		"blob_connection_string",
	]:
		val = os.getenv(key)
		if val:
			return val
	return None


def _detect_storage_source() -> Tuple[str, bool]:
	for key in [
		"AzureWebJobsStorage",
		"AZURE_STORAGE_CONNECTION_STRING",
		"BLOB_CONNECTION_STRING",
		"blob_connection_string",
	]:
		if os.getenv(key):
			return key, True
	return "(none)", False


def _get_blob_service() -> BlobServiceClient | None:  # type: ignore
	conn = _get_connection_string()
	if not conn or not BlobServiceClient:
		return None
	try:
		return BlobServiceClient.from_connection_string(conn)  # type: ignore[arg-type]
	except Exception:
		return None


def _ensure_container(client: BlobServiceClient, name: str) -> None:  # type: ignore
	try:
		client.create_container(name)
	except Exception:
		# Likely already exists – ignore
		pass


def _sanitize_filename(name: str) -> str:
	name = name.strip().replace("..", "_").replace("/", "_").replace("\\", "_")
	if not name:
		name = "unnamed"
	return name


def save_uploaded_text(original_name: str, content: str) -> str:
	"""Persist uploaded content to blob storage (or fallback in-memory).

	Returns the blob name actually used.
	"""
	safe = _sanitize_filename(original_name)
	# Add timestamp to reduce collision risk
	timestamp = _dt.datetime.utcnow().strftime("%Y%m%d%H%M%S")
	blob_name = f"{timestamp}_{safe}"

	client = _get_blob_service()
	if client:
		try:
			_ensure_container(client, UPLOAD_CONTAINER)
			container = client.get_container_client(UPLOAD_CONTAINER)
			container.upload_blob(name=blob_name, data=content.encode("utf-8"), overwrite=True)
			return blob_name
		except Exception as ex:  # Fall back quietly; we still return success to caller
			print(f"[shared_blob] Blob upload failed, falling back to memory: {ex}")

	# Fallback (dev only): store in memory – not persistent across cold starts
	_IN_MEMORY_STORE[blob_name] = content
	return blob_name


def list_uploaded_docs() -> List[str]:
	client = _get_blob_service()
	names: List[str] = []
	if client:
		try:
			container = client.get_container_client(UPLOAD_CONTAINER)
			if container.exists():  # type: ignore[attr-defined]
				names = [b.name for b in container.list_blobs()]  # type: ignore
		except Exception as ex:
			print(f"[shared_blob] list_uploaded_docs blob error: {ex}")
	# Include in-memory fallback entries
	names.extend(_IN_MEMORY_STORE.keys())
	# Deduplicate while preserving order
	seen = set()
	out: List[str] = []
	for n in names:
		if n not in seen:
			seen.add(n)
			out.append(n)
	return out


def generate_stub_video(doc_name: str) -> Dict[str, Any]:
	# Placeholder logic – future version will rely on C# / AI pipeline
	return {
		"doc": doc_name,
		"scenes": [
			{"index": 1, "title": "Introduction", "text": f"Overview of {doc_name}"},
			{"index": 2, "title": "Details", "text": "Key concepts..."},
		],
		"generated": True,
	}


def generate_stub_quiz(doc_name: str) -> Dict[str, Any]:
	return {
		"doc": doc_name,
		"questions": [
			{
				"q": f"What is the primary purpose of {doc_name}?",
				"options": ["Purpose A", "Purpose B", "Purpose C", "Purpose D"],
				"answer": 0,
			},
		],
	}


def get_processing_status(doc_name: str) -> Dict[str, Any]:
	# Simple synthesized status for now.
	return {
		"doc": doc_name,
		"status": "uploaded",
		"videoReady": False,
		"quizReady": False,
		"pipeline": "stub",
	}


__all__ = [
	"save_uploaded_text",
	"list_uploaded_docs",
	"generate_stub_video",
	"generate_stub_quiz",
	"get_processing_status",
	"try_get_processed_video",
	"debug_storage_config",
]


def try_get_processed_video(doc_name: str):
	"""Placeholder for future: attempt to fetch a processed video JSON.

	For now returns None so caller can fall back to stub generation. Later this will
	look up a blob like generated-videos/{doc_name}.json.
	"""
	return None


def debug_storage_config() -> Dict[str, Any]:
	key_used, found = _detect_storage_source()
	raw = _get_connection_string() or ""
	masked = (raw[:20] + "…" + raw[-4:]) if raw and len(raw) > 30 else raw
	return {
		"envVarDetected": key_used,
		"found": found,
		"maskedValue": masked,
		"hasBlobLib": BlobServiceClient is not None,
	}
