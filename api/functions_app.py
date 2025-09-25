import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@app.route(route="health")
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("healthy", status_code=200)

@app.route(route="debug-test")
def debug_test(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("OK", status_code=200)

@app.route(route="ping")
def ping(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("pong", status_code=200)

@app.route(route="quiz/sample")
def quiz_sample(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(
        "{\n  \"questions\": [\n    {\n      \"id\": \"q1\",\n      \"text\": \"Sample question working.\",\n      \"options\": [\"A\",\"B\",\"C\",\"D\"],\n      \"correctIndex\": 0\n    }\n  ]\n}",
        status_code=200,
        mimetype="application/json",
        headers={"Cache-Control": "no-store"}
    )
