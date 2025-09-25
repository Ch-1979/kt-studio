import azure.functions as func
from . import logic  # type: ignore

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    return logic.handle(req)
