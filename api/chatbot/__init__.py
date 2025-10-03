import azure.functions as func  # type: ignore
from .chat_logic import handle_request


def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    return handle_request(req)
