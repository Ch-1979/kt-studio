import json
import azure.functions as func

def main(req: func.HttpRequest) -> func.HttpResponse:
    sample = {
        "questions": [
            {
                "id": "q1",
                "text": "What is the primary database used in Project Alpha's architecture?",
                "options": ["MySQL", "PostgreSQL", "Cosmos DB", "MongoDB"],
                "correctIndex": 1
            }
        ]
    }
    return func.HttpResponse(json.dumps(sample), mimetype="application/json", status_code=200, headers={"Cache-Control": "no-store"})
