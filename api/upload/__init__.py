import json
import azure.functions as func
from . import function_logic  # type: ignore  # will be created below

def main(req: func.HttpRequest) -> func.HttpResponse:  # type: ignore
    return function_logic.handle(req)
