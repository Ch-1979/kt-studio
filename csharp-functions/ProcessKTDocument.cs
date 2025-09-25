using System.Text;
using System.Text.Json;
using System.Linq; // Needed for LINQ extensions like Select
using System.Collections.Generic; // Needed for List<T>
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KTStudio.Functions;

public class ProcessKTDocument
{
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ILogger<ProcessKTDocument> _logger;
    private readonly IConfiguration _config;

    public ProcessKTDocument(BlobServiceClient blobServiceClient, ILogger<ProcessKTDocument> logger, IConfiguration config)
    {
        _blobServiceClient = blobServiceClient;
        _logger = logger;
        _config = config;
    }

    [Function("ProcessKTDocument")]
    public async Task Run([BlobTrigger("uploaded-docs/{name}", Connection = "AzureWebJobsStorage")] BlobClient blobClient, string name)
    {
        _logger.LogInformation("Triggered ProcessKTDocument for blob: {BlobName}", name);

        var documentText = await ReadBlobTextAsync(blobClient);
        _logger.LogInformation("Read {Length} chars from document", documentText.Length);

        var (summary, scenes, quiz) = GenerateContent(documentText);

        var videoJson = new
        {
            sourceDocument = name,
            summary,
            scenes = scenes.Select((s, i) => new { index = i + 1, text = s }),
            createdUtc = DateTime.UtcNow
        };
        var quizJson = new
        {
            sourceDocument = name,
            createdUtc = DateTime.UtcNow,
            questions = quiz
        };

        await UploadJsonAsync("generated-videos", Path.ChangeExtension(name, ".video.json"), videoJson);
        await UploadJsonAsync("quiz-data", Path.ChangeExtension(name, ".quiz.json"), quizJson);

        _logger.LogInformation("Processing complete for {BlobName}", name);
    }

    private async Task<string> ReadBlobTextAsync(BlobClient blob)
    {
        using var stream = new MemoryStream();
        await blob.DownloadToAsync(stream);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private (string Summary, List<string> Scenes, List<object> Quiz) GenerateContent(string documentText)
    {
        // Extremely simple deterministic fallback: split into paragraphs, cap at 6 scenes.
        var paragraphs = documentText.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Trim())
            .Where(p => p.Length > 10)
            .Take(6)
            .ToList();
        if (paragraphs.Count == 0)
        {
            paragraphs.Add("The uploaded document had insufficient textual content; this is a placeholder scene.");
            paragraphs.Add("Add more meaningful text to generate richer scenes and quizzes.");
        }
        var summarySource = paragraphs.First();
        var summary = summarySource.Length > 160 ? summarySource.Substring(0, 160) + "..." : summarySource;
        var quiz = new List<object>
        {
            new { question = "Is this content generated without external AI services?", options = new[]{"Yes","No","Unsure","Partially"}, correctIndex = 0 },
            new { question = "How many scenes were produced?", options = new[]{"1","2","3+","None"}, correctIndex = paragraphs.Count >= 3 ? 2 : (paragraphs.Count == 2 ? 1 : 0) },
            new { question = "What can you configure later for smarter output?", options = new[]{"Azure OpenAI","FTP","POP3","SMTP"}, correctIndex = 0 }
        };
        return (summary, paragraphs, quiz);
    }

    private async Task UploadJsonAsync(string containerName, string blobName, object payload)
    {
        var container = _blobServiceClient.GetBlobContainerClient(containerName);
        await container.CreateIfNotExistsAsync(PublicAccessType.None);
        var blob = container.GetBlobClient(blobName);
        using var ms = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(payload, new JsonSerializerOptions { WriteIndented = true }));
        await blob.UploadAsync(ms, overwrite: true);
    }
}
