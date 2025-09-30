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
from typing import List, Dict, Any, Optional, Tuple, Iterable

try:  # Import optional blob packages; they are present in requirements.txt
	from azure.storage.blob import BlobServiceClient  # type: ignore
except Exception:  # pragma: no cover - If not available we fall back
	BlobServiceClient = None  # type: ignore

UPLOAD_CONTAINER = "uploaded-docs"
VIDEO_CONTAINER = "generated-videos"
VIDEO_FILE_CONTAINER = "generated-video-files"
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
		"sourceDocument": doc_name,
		"summary": f"High-level overview of {doc_name}",
		"sceneCount": 2,
		"createdUtc": _dt.datetime.utcnow().isoformat() + "Z",
		"scenes": [
			{
				"index": 1,
				"title": "Introduction",
				"text": f"Overview of {doc_name}",
				"keywords": ["overview", "context"],
				"badge": "Overview",
				"imageUrl": None,
				"imageAlt": None,
				"visualPrompt": "Isometric illustration of training overview"
			},
			{
				"index": 2,
				"title": "Key Concepts",
				"text": "Key concepts highlighted in the knowledge transfer document.",
				"keywords": ["concepts", "details"],
				"badge": "Highlights",
				"imageUrl": None,
				"imageAlt": None,
				"visualPrompt": "Modern diagram referencing cloud architecture"
			},
		],
		"generated": True,
		"videoAsset": None,
	}


def generate_stub_quiz(doc_name: str) -> Dict[str, Any]:
	return {
		"doc": doc_name,
		"questions": [
			{
				"id": "q1",
				"text": f"What is the primary purpose of {doc_name}?",
				"options": ["Purpose A", "Purpose B", "Purpose C", "Purpose D"],
				"correctIndex": 0,
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
	"find_processed_artifacts",
	"load_processed_video",
	"load_processed_quiz",
	"list_known_doc_bases",
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


# ---------------- Real artifact retrieval helpers ---------------- #

def _list_blobs(container: str) -> Iterable[str]:
	client = _get_blob_service()
	if not client:
		return []
	try:
		cc = client.get_container_client(container)
		if not cc.exists():  # type: ignore[attr-defined]
			return []
		return [b.name for b in cc.list_blobs()]  # type: ignore
	except Exception:
		return []


def _download_text(container: str, blob_name: str) -> Optional[str]:
	client = _get_blob_service()
	if not client:
		return None
	try:
		cc = client.get_container_client(container)
		bc = cc.get_blob_client(blob_name)
		data = bc.download_blob().readall()
		return data.decode("utf-8", errors="ignore")
	except Exception:
		return None


def _match_processed(doc_base: str, blob_name: str) -> bool:
	# Accept patterns like TIMESTAMP_original.ext.video.json or direct original.video.json
	# Strategy: strip any leading 14-digit timestamp + underscore
	candidate = blob_name
	if len(candidate) > 15 and candidate[:14].isdigit() and candidate[14] == '_':
		candidate = candidate[15:]
	# Remove .video.json / .quiz.json
	if candidate.endswith('.video.json'):
		core = candidate[:-11]
	elif candidate.endswith('.quiz.json'):
		core = candidate[:-10]
	else:
		core = candidate
	# Remove extension (e.g., .txt, .docx, .pdf) if present
	if '.' in core:
		core = core.rsplit('.', 1)[0]
	return core.lower() == doc_base.lower()


def _extract_doc_base(blob_name: str) -> str:
	candidate = blob_name
	if len(candidate) > 15 and candidate[:14].isdigit() and candidate[14] == '_':
		candidate = candidate[15:]
	if candidate.endswith('.video.json'):
		candidate = candidate[:-11]
	elif candidate.endswith('.quiz.json'):
		candidate = candidate[:-10]
	if '.' in candidate:
		candidate = candidate.rsplit('.', 1)[0]
	return candidate


def find_processed_artifacts(doc_base: str) -> Dict[str, Optional[str]]:
	video_blob = None
	video_file_blob = None
	thumbnail_blob = None
	quiz_blob = None
	for name in _list_blobs(VIDEO_CONTAINER):
		if name.endswith('.video.json') and _match_processed(doc_base, name):
			video_blob = name
			break
	for name in _list_blobs(VIDEO_FILE_CONTAINER):
		lowered = name.lower()
		if lowered.endswith(('.mp4', '.mov', '.mkv', '.webm')) and _match_processed(doc_base, name):
			video_file_blob = name
		elif lowered.endswith(('.png', '.jpg', '.jpeg', '.webp')) and _match_processed(doc_base, name):
			thumbnail_blob = name if thumbnail_blob is None else thumbnail_blob
	for name in _list_blobs(QUIZ_CONTAINER):
		if name.endswith('.quiz.json') and _match_processed(doc_base, name):
			quiz_blob = name
			break
	return {"video": video_blob, "videoFile": video_file_blob, "thumbnail": thumbnail_blob, "quiz": quiz_blob}


def load_processed_video(doc_base: str) -> Optional[Dict[str, Any]]:
	art = find_processed_artifacts(doc_base)
	if not art.get("video"):
		return None
	text = _download_text(VIDEO_CONTAINER, art["video"])
	if not text:
		return None
	try:
		return json.loads(text)
	except Exception:
		return None


def load_processed_quiz(doc_base: str) -> Optional[Dict[str, Any]]:
	art = find_processed_artifacts(doc_base)
	if not art.get("quiz"):
		return None
	text = _download_text(QUIZ_CONTAINER, art["quiz"])
	if not text:
		return None
	try:
		return json.loads(text)
	except Exception:
		return None


def list_known_doc_bases() -> List[str]:
	"""Return all document base names we know about (uploaded or processed)."""
	bases: set[str] = set()

	for uploaded in list_uploaded_docs():
		name = uploaded
		if len(name) > 15 and name[:14].isdigit() and name[14] == '_':
			name = name[15:]
		if '.' in name:
			name = name.rsplit('.', 1)[0]
		bases.add(name)

	for blob in _list_blobs(VIDEO_CONTAINER):
		if blob.endswith('.video.json'):
			bases.add(_extract_doc_base(blob))
	for blob in _list_blobs(VIDEO_FILE_CONTAINER):
		bases.add(_extract_doc_base(blob))
	for blob in _list_blobs(QUIZ_CONTAINER):
		if blob.endswith('.quiz.json'):
			bases.add(_extract_doc_base(blob))

	return sorted(bases)
