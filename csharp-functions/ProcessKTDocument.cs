using System.Text;
using System.Text.Json;
using System.Linq; // Needed for LINQ extensions like Select
using System.Collections.Generic; // Needed for List<T>
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.AI.OpenAI;
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
            _logger.LogInformation("[ProcessKTDocument] Triggered for blob Name={Name} Uri={Uri}", name, blobClient.Uri);
            var swTotal = System.Diagnostics.Stopwatch.StartNew();
        try
        {
                var downloadInfo = await blobClient.DownloadContentAsync();
                var content = downloadInfo.Value.Content.ToString();
                _logger.LogInformation("[ProcessKTDocument] Downloaded content length={Length}", content.Length);

            var (summary, scenes, quiz) = GenerateContent(content);

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

                swTotal.Stop();
                _logger.LogInformation("[ProcessKTDocument] Generated video JSON and quiz JSON in {ElapsedMs} ms", swTotal.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
                _logger.LogError(ex, "[ProcessKTDocument] Error processing blob {Name}", name);
            throw; // preserve failure semantics so platform surfaces the error
        }
    }

    private async Task<string> ReadBlobTextAsync(BlobClient blob)
    {
        using var stream = new MemoryStream();
        await blob.DownloadToAsync(stream);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private (string Summary, List<string> Scenes, List<object> Quiz) GenerateContent(string documentText)
    {
        var endpoint = _config["AzureOpenAI:Endpoint"] ?? _config["AzureOpenAI__Endpoint"];
        var apiKey = _config["AzureOpenAI:ApiKey"] ?? _config["AzureOpenAI__ApiKey"];
        var deployment = _config["AzureOpenAI:Deployment"] ?? _config["AzureOpenAI__Deployment"];

        if (!string.IsNullOrWhiteSpace(endpoint) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(deployment))
        {
            try
            {
                _logger.LogInformation("[ProcessKTDocument] Using Azure OpenAI deployment {Deployment}", deployment);
                var client = new OpenAIClient(new Uri(endpoint), new AzureKeyCredential(apiKey));
                // Prompt engineering: request structured JSON.
                var systemPrompt = "You are an assistant that extracts training content. Produce: summary (<=160 chars), 4-6 concise scene texts, and 3 multiple choice quiz questions with 4 options and index of correct option.";
                var userPrompt = $"SOURCE DOCUMENT:\n---\n{Truncate(documentText, 5000)}\n---\nRespond strictly in JSON with keys summary, scenes, quiz. quiz is array of objects (question, options[], correctIndex).";
                var chat = new ChatCompletionsOptions()
                {
                    Temperature = 0.4f,
                    MaxTokens = 800,
                    Messages =
                    {
                        new ChatRequestSystemMessage(systemPrompt),
                        new ChatRequestUserMessage(userPrompt)
                    }
                };
                var resp = client.GetChatCompletions(deployment, chat);
                var content = resp.Value.Choices.First().Message.Content.FirstOrDefault()?.Text ?? string.Empty;
                var parsed = JsonSerializer.Deserialize<AoaiResponse>(content, new JsonSerializerOptions{PropertyNameCaseInsensitive=true});
                if (parsed != null && parsed.Scenes?.Count > 0 && parsed.Quiz?.Count > 0)
                {
                    var quizObjs = parsed.Quiz.Select(q => new { question = q.Question, options = q.Options, correctIndex = q.CorrectIndex }).Cast<object>().ToList();
                    return (parsed.Summary ?? "", parsed.Scenes!, quizObjs);
                }
                _logger.LogWarning("[ProcessKTDocument] Azure OpenAI returned unusable response; falling back.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[ProcessKTDocument] Azure OpenAI generation failed; using fallback.");
            }
        }
        // Fallback deterministic logic
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

    private static string Truncate(string input, int max)
        => string.IsNullOrEmpty(input) ? input : (input.Length <= max ? input : input.Substring(0, max));

    private class AoaiResponse
    {
        public string? Summary { get; set; }
        public List<string>? Scenes { get; set; }
        public List<QuizItem>? Quiz { get; set; }
    }
    private class QuizItem
    {
        public string Question { get; set; } = string.Empty;
        public List<string> Options { get; set; } = new();
        public int CorrectIndex { get; set; }
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
