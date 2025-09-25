import json
import azure.functions as func  # type: ignore
from ..shared_blob import (
	find_processed_artifacts,
)


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
	doc = req.route_params.get("docName") if hasattr(req, "route_params") else None
	if not doc:
		return func.HttpResponse(json.dumps({"error": "Missing docName"}), status_code=400, mimetype="application/json")
	base = doc
	artifacts = find_processed_artifacts(base)
	video_ready = artifacts.get("video") is not None
	quiz_ready = artifacts.get("quiz") is not None
	ready = video_ready and quiz_ready
	payload = {
		"doc": base,
		"video": video_ready,
		"quiz": quiz_ready,
		"ready": ready,
		"artifacts": artifacts,
	}
	return func.HttpResponse(
		json.dumps(payload),
		status_code=200,
		mimetype="application/json",
		headers={"Cache-Control": "no-store"},
	)
