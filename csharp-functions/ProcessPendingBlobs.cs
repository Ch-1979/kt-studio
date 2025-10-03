using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Generic;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace KTStudio.Functions;

public class ProcessPendingBlobs
{
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ProcessKTDocument _processor;
    private readonly ILogger<ProcessPendingBlobs> _logger;

    public ProcessPendingBlobs(BlobServiceClient blobServiceClient, ProcessKTDocument processor, ILogger<ProcessPendingBlobs> logger)
    {
        _blobServiceClient = blobServiceClient;
        _processor = processor;
        _logger = logger;
    }

    // GET /api/process/pending?max=10&force=true
    [Function("ProcessPendingBlobs")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "get", Route = "process/pending")] HttpRequestData req)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        int max = 0;
        if (int.TryParse(query.Get("max"), out var parsed) && parsed > 0)
        {
            max = parsed;
        }
        bool force = string.Equals(query.Get("force"), "true", StringComparison.OrdinalIgnoreCase);

        var container = _blobServiceClient.GetBlobContainerClient("uploaded-docs");
        await container.CreateIfNotExistsAsync();

        var processed = new List<object>();
        int count = 0;
        await foreach (BlobItem blob in container.GetBlobsAsync())
        {
            if (max > 0 && count >= max) break;
            var name = blob.Name;

            // Determine if already processed by checking existence of corresponding .video.json blob.
            var videosContainer = _blobServiceClient.GetBlobContainerClient("generated-videos");
            var expectedVideoJson = name + ".video.json"; // original name + extension + .video.json; fallback try w/out extension below
            bool already = await videosContainer.ExistsAsync() && (await videosContainer.GetBlobsAsync(prefix: name).ToListAsync()).Any(b => b.Name.EndsWith(".video.json", StringComparison.OrdinalIgnoreCase) && b.Name.Contains(System.IO.Path.GetFileNameWithoutExtension(name), StringComparison.OrdinalIgnoreCase));
            if (already && !force)
            {
                processed.Add(new { blob = name, skipped = true, reason = "already processed" });
                continue;
            }

            try
            {
                var blobClient = container.GetBlobClient(name);
                var download = await blobClient.DownloadContentAsync();
                var text = download.Value.Content.ToString();
                var contentType = download.Value.Details?.ContentType;
                await _processor.ProcessContentAsync(name, text, contentType);
                processed.Add(new { blob = name, processed = true });
                count++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[ProcessPendingBlobs] Failed processing {Blob}", name);
                processed.Add(new { blob = name, error = ex.Message });
            }
        }

        var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
        await response.WriteStringAsync(JsonSerializer.Serialize(new
        {
            timestampUtc = DateTime.UtcNow,
            totalReturned = processed.Count,
            forced = force,
            processed
        }, new JsonSerializerOptions { WriteIndented = true }));
        response.Headers.Add("Content-Type", "application/json");
        return response;
    }
}

internal static class AsyncEnumerableHelpers
{
    public static async Task<List<T>> ToListAsync<T>(this IAsyncEnumerable<T> source)
    {
        var list = new List<T>();
        await foreach (var item in source)
        {
            list.Add(item);
        }
        return list;
    }
}