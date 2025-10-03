using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.Storage.Blobs;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;

namespace KTStudio.Functions;

public class ProcessKTDocumentEvent
{
    private readonly ProcessKTDocument _processor;
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ILogger<ProcessKTDocumentEvent> _logger;

    public ProcessKTDocumentEvent(ProcessKTDocument processor, BlobServiceClient blobServiceClient, ILogger<ProcessKTDocumentEvent> logger)
    {
        _processor = processor;
        _blobServiceClient = blobServiceClient;
        _logger = logger;
    }

    // Event Grid schema for Storage Blob Created events
    public record BlobCreatedEvent(string? topic, string? subject, string? eventType, DateTime? eventTime, BlobCreatedData data);
    public record BlobCreatedData(string api, string clientRequestId, string requestId, string eTag, string contentType, long contentLength, string blobType, string url, string sequencer, StorageDiagnostics storageDiagnostics);
    public record StorageDiagnostics(string batchId);

    [Function("ProcessKTDocumentEvent")]
    public async Task Run([EventGridTrigger] Azure.Messaging.EventGrid.EventGridEvent eventGridEvent)
    {
        if (eventGridEvent == null)
        {
            _logger.LogWarning("[ProcessKTDocumentEvent] Received null EventGridEvent");
            return;
        }

        _logger.LogInformation("[ProcessKTDocumentEvent] Event received: Id={Id} Type={Type} Subject={Subject}", eventGridEvent.Id, eventGridEvent.EventType, eventGridEvent.Subject);

        if (!string.Equals(eventGridEvent.EventType, "Microsoft.Storage.BlobCreated", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogDebug("[ProcessKTDocumentEvent] Ignored event type {Type}", eventGridEvent.EventType);
            return;
        }

        try
        {
            // Subject format: "/blobServices/default/containers/<container>/blobs/<blobName>"
            var subject = eventGridEvent.Subject ?? string.Empty;
            var parts = subject.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var containerIndex = Array.FindIndex(parts, p => string.Equals(p, "containers", StringComparison.OrdinalIgnoreCase));
            if (containerIndex < 0 || containerIndex + 2 >= parts.Length)
            {
                _logger.LogWarning("[ProcessKTDocumentEvent] Unable to parse container/blob from subject: {Subject}", subject);
                return;
            }
            var containerName = parts[containerIndex + 1];
            var blobPath = string.Join('/', parts[(containerIndex + 2)..]);

            if (!string.Equals(containerName, "uploaded-docs", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogDebug("[ProcessKTDocumentEvent] Event for container {Container} ignored", containerName);
                return;
            }

            var blobClient = _blobServiceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
            if (!await blobClient.ExistsAsync())
            {
                _logger.LogWarning("[ProcessKTDocumentEvent] Blob not found: {Path}", blobPath);
                return;
            }

            var download = await blobClient.DownloadContentAsync();
            var text = download.Value.Content.ToString();
            var contentType = download.Value.Details?.ContentType;
            await _processor.ProcessContentAsync(blobPath, text, contentType);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ProcessKTDocumentEvent] Failed to process Event Grid blob event");
        }
    }
}
