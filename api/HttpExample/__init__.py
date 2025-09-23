import logging
import json
import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@app.route(route="ping")
def ping(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("pong", status_code=200)

@app.route(route="quiz/sample")
def quiz_sample(req: func.HttpRequest) -> func.HttpResponse:
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
    return func.HttpResponse(
        body=json.dumps(sample),
        mimetype="application/json",
        status_code=200,
        headers={"Cache-Control": "no-store"}
    )
