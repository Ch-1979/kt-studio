import logging
import azure.functions as func

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("debugtest function invoked")
    return func.HttpResponse("classic-ok", status_code=200)
