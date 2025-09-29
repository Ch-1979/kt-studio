using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KTStudio.Functions;

public class ProcessKTDocument
{
    private static readonly HttpClient HttpClient = new();

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

            var (summary, scenes, quiz) = await GenerateContentAsync(content);

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
            throw;
        }
    }

    private async Task<(string Summary, List<string> Scenes, List<object> Quiz)> GenerateContentAsync(string documentText)
    {
        var endpoint = _config["AzureOpenAI:Endpoint"] ?? _config["AzureOpenAI__Endpoint"];
        var apiKey = _config["AzureOpenAI:ApiKey"] ?? _config["AzureOpenAI__ApiKey"];
        var deployment = _config["AzureOpenAI:Deployment"] ?? _config["AzureOpenAI__Deployment"];

        if (!string.IsNullOrWhiteSpace(endpoint) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(deployment))
        {
            try
            {
                var baseUri = endpoint.EndsWith('/') ? endpoint : endpoint + "/";
                var requestUri = new Uri(new Uri(baseUri), $"openai/deployments/{deployment}/chat/completions?api-version=2024-08-01-preview");

                var payload = new
                {
                    messages = new object[]
                    {
                        new
                        {
                            role = "system",
                            content = "You extract training content. Return strict JSON with keys: summary (<=160 chars), scenes (array of 4-6 short strings), quiz (array of {question, options[4], correctIndex})."
                        },
                        new
                        {
                            role = "user",
                            content = $"SOURCE DOCUMENT:\n---\n{Truncate(documentText, 5000)}\n---\nRespond with JSON only."
                        }
                    },
                    temperature = 0.4,
                    max_tokens = 800
                };

                var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
                {
                    Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
                };

                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                request.Headers.Add("api-key", apiKey);

                var response = await HttpClient.SendAsync(request);
                if (response.IsSuccessStatusCode)
                {
                    var raw = await response.Content.ReadAsStringAsync();
                    var parsed = TryParseAoaiResponse(raw);
                    if (parsed != null && parsed.Scenes?.Count > 0 && parsed.Quiz?.Count > 0)
                    {
                        var quizObjects = parsed.Quiz
                            .Select((q, i) => (object)new
                            {
                                id = q.Id ?? $"q{i + 1}",
                                text = q.Question,
                                options = q.Options,
                                correctIndex = q.CorrectIndex
                            })
                            .ToList();

                        return (parsed.Summary ?? string.Empty, parsed.Scenes, quizObjects);
                    }

                    _logger.LogWarning("[ProcessKTDocument] Azure OpenAI response parse failed; using fallback.");
                }
                else
                {
                    var body = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("[ProcessKTDocument] Azure OpenAI HTTP {Status}: {Body}", response.StatusCode, body);
                }
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
            new { id = "q1", text = "Is this content generated without external AI services?", options = new[]{"Yes","No","Unsure","Partially"}, correctIndex = 0 },
            new { id = "q2", text = "How many scenes were produced?", options = new[]{"1","2","3+","None"}, correctIndex = paragraphs.Count >= 3 ? 2 : (paragraphs.Count == 2 ? 1 : 0) },
            new { id = "q3", text = "What can you configure later for smarter output?", options = new[]{"Azure OpenAI","FTP","POP3","SMTP"}, correctIndex = 0 }
        };
        return (summary, paragraphs, quiz);
    }

    private static AoaiResponse? TryParseAoaiResponse(string raw)
    {
        try
        {
            using var document = JsonDocument.Parse(raw);
            if (!document.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
            {
                return null;
            }

            var message = choices[0].GetProperty("message");
            string? assistantText = null;

            if (message.TryGetProperty("content", out var contentElement))
            {
                assistantText = contentElement.ValueKind switch
                {
                    JsonValueKind.String => contentElement.GetString(),
                    JsonValueKind.Array => string.Join("\n", contentElement.EnumerateArray()
                        .Select(segment => segment.TryGetProperty("text", out var textElement) ? textElement.GetString() : null)
                        .Where(text => !string.IsNullOrWhiteSpace(text))),
                    _ => null
                };
            }

            if (string.IsNullOrWhiteSpace(assistantText))
            {
                return null;
            }

            var firstBrace = assistantText.IndexOf('{');
            if (firstBrace > 0)
            {
                assistantText = assistantText[firstBrace..];
            }

            return JsonSerializer.Deserialize<AoaiResponse>(assistantText, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch
        {
            return null;
        }
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
        public string? Id { get; set; }
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
