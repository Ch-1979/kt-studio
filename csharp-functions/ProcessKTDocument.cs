using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Diagnostics;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
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

            var (summary, scenes, quiz) = await GenerateContentAsync(name, content);

            var videoJson = new
            {
                sourceDocument = name,
                summary,
                sceneCount = scenes.Count,
                createdUtc = DateTime.UtcNow,
                scenes = scenes.Select(scene => new
                {
                    index = scene.Index,
                    title = scene.Title,
                    text = scene.Narration,
                    keywords = scene.Keywords,
                    badge = scene.Badge,
                    imageUrl = scene.ImageUrl,
                    imageAlt = scene.ImageAlt,
                    visualPrompt = scene.VisualPrompt
                })
            };

            var quizJson = new
            {
                sourceDocument = name,
                createdUtc = DateTime.UtcNow,
                questions = quiz.Select(q => new
                {
                    id = q.Id,
                    text = q.Text,
                    options = q.Options,
                    correctIndex = q.CorrectIndex,
                    explanation = q.Explanation
                })
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

    private async Task<(string Summary, List<SceneData> Scenes, List<QuizQuestion> Quiz)> GenerateContentAsync(string docName, string documentText)
    {
        var endpoint = _config["AzureOpenAI:Endpoint"] ?? _config["AzureOpenAI__Endpoint"];
        var apiKey = _config["AzureOpenAI:ApiKey"] ?? _config["AzureOpenAI__ApiKey"];
        var deployment = _config["AzureOpenAI:Deployment"] ?? _config["AzureOpenAI__Deployment"];

        GenerationResult? generated = null;

        if (!string.IsNullOrWhiteSpace(endpoint) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(deployment))
        {
            try
            {
                generated = await TryGenerateWithAzureOpenAi(endpoint, apiKey, deployment, documentText);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[ProcessKTDocument] Azure OpenAI generation failed; using fallback.");
            }
        }

        List<SceneData> scenes;
        List<QuizQuestion> quiz;
        string summary;

        if (generated != null && generated.Scenes.Any() && generated.Quiz.Any())
        {
            summary = generated.Summary;
            scenes = generated.Scenes.Select((scene, idx) => SceneData.FromGeneration(scene, idx)).ToList();
            quiz = generated.Quiz.Select((q, idx) => QuizQuestion.FromGeneration(q, idx)).ToList();
        }
        else
        {
            (summary, scenes, quiz) = BuildFallbackContent(documentText);
        }

        await PopulateSceneImagesAsync(docName, scenes);

        return (summary, scenes, quiz);
    }

    private (string Summary, List<SceneData> Scenes, List<QuizQuestion> Quiz) BuildFallbackContent(string documentText)
    {
        var paragraphs = documentText.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Trim())
            .Where(p => p.Length > 25)
            .Distinct()
            .Take(5)
            .ToList();

        if (paragraphs.Count == 0)
        {
            paragraphs.Add("The uploaded document did not contain enough readable text to generate a storyboard. Add richer descriptions to unlock full AI visuals.");
        }

        var summarySource = paragraphs.First();
        var summary = summarySource.Length > 160 ? summarySource[..160] + "..." : summarySource;

        var scenes = paragraphs.Select((text, idx) => SceneData.FromFallback(text, idx)).ToList();

        var quiz = new List<QuizQuestion>
        {
            new("q1", "What is the central topic highlighted in this training asset?", GuessOptions(paragraphs.First()), 0, "Focus on the opening paragraph to recall the theme."),
            new("q2", "How many major concepts were emphasized?", new List<string>{"One", "Two", "Three or more", "None"}, scenes.Count >= 3 ? 2 : scenes.Count == 2 ? 1 : 0, "Each scene maps to a concept."),
            new("q3", "Which Azure service powers the AI storyboard generation?", new List<string>{"Azure OpenAI", "Azure FTP", "Azure Queues", "Azure CDN"}, 0, "Azure OpenAI transforms the document into scenes and quizzes.")
        };

        return (summary, scenes, quiz);

        static List<string> GuessOptions(string text)
        {
            var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Where(w => w.Length > 3)
                .Select(Clean)
                .Distinct()
                .Take(3)
                .ToList();
            while (words.Count < 4)
            {
                words.Add(words.Count switch
                {
                    0 => "Overview",
                    1 => "Details",
                    2 => "Best Practices",
                    _ => "Summary"
                });
            }
            return words;

            static string Clean(string token) => new string(token.Where(char.IsLetterOrDigit).ToArray());
        }
    }

    private async Task PopulateSceneImagesAsync(string docName, List<SceneData> scenes)
    {
        if (!scenes.Any()) return;

        var imageDeployment = _config["AzureOpenAI:ImageDeployment"] ?? _config["AzureOpenAI__ImageDeployment"];
        var endpoint = _config["AzureOpenAI:Endpoint"] ?? _config["AzureOpenAI__Endpoint"];
        var apiKey = _config["AzureOpenAI:ApiKey"] ?? _config["AzureOpenAI__ApiKey"];

        if (string.IsNullOrWhiteSpace(imageDeployment) || string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(apiKey))
        {
            return;
        }

        var baseUri = endpoint.EndsWith('/') ? endpoint : endpoint + "/";
        var requestUri = new Uri(new Uri(baseUri), $"openai/deployments/{imageDeployment}/images/generations?api-version=2024-02-15-preview");

        for (var i = 0; i < scenes.Count; i++)
        {
            var scene = scenes[i];
            if (!string.IsNullOrWhiteSpace(scene.ImageUrl)) continue;
            var prompt = scene.VisualPrompt ?? scene.CreateDefaultVisualPrompt();
            if (string.IsNullOrWhiteSpace(prompt)) continue;

            try
            {
                var payload = new
                {
                    prompt,
                    size = "832x468",
                    n = 1,
                    response_format = "b64_json"
                };

                using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
                {
                    Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
                };
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                request.Headers.Add("api-key", apiKey);

                using var response = await HttpClient.SendAsync(request);
                if (!response.IsSuccessStatusCode)
                {
                    var body = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("[ProcessKTDocument] Image generation failed for scene {Scene} HTTP {Status}: {Body}", scene.Index, response.StatusCode, body);
                    continue;
                }

                var raw = await response.Content.ReadAsStringAsync();
                if (!TryExtractImageBase64(raw, out var b64) || string.IsNullOrWhiteSpace(b64))
                {
                    continue;
                }

                var bytes = Convert.FromBase64String(b64);
                var imageUrl = await UploadSceneImageAsync(docName, scene.Index, bytes);
                if (!string.IsNullOrWhiteSpace(imageUrl))
                {
                    scene.ImageUrl = imageUrl;
                    scene.ImageAlt = scene.Title;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[ProcessKTDocument] Unable to generate image for scene {Scene}", scene.Index);
            }
        }
    }

    private static bool TryExtractImageBase64(string raw, out string? b64)
    {
        b64 = null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("data", out var dataArray) || dataArray.GetArrayLength() == 0)
            {
                return false;
            }
            var item = dataArray[0];
            if (item.TryGetProperty("b64_json", out var b64Element))
            {
                b64 = b64Element.GetString();
                return !string.IsNullOrWhiteSpace(b64);
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    private async Task<string?> UploadSceneImageAsync(string docName, int sceneIndex, byte[] bytes)
    {
        if (bytes.Length == 0) return null;

        var container = _blobServiceClient.GetBlobContainerClient("storyboard-images");
        await container.CreateIfNotExistsAsync(PublicAccessType.Blob);

        var docBase = Path.GetFileNameWithoutExtension(docName);
        var safeDocBase = new string(docBase.Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray()).Trim('-');
        if (string.IsNullOrWhiteSpace(safeDocBase))
        {
            safeDocBase = "document";
        }
        var blobName = $"{safeDocBase}/scene-{sceneIndex:00}.png";
        var blob = container.GetBlobClient(blobName);

        using (var ms = new MemoryStream(bytes))
        {
            await blob.UploadAsync(ms, overwrite: true);
        }

        if (blob.CanGenerateSasUri)
        {
            var builder = new BlobSasBuilder(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddYears(1))
            {
                BlobContainerName = container.Name,
                BlobName = blobName
            };
            var sas = blob.GenerateSasUri(builder);
            return sas.ToString();
        }

        return blob.Uri.ToString();
    }

    private async Task<GenerationResult?> TryGenerateWithAzureOpenAi(string endpoint, string apiKey, string deployment, string documentText)
    {
        var baseUri = endpoint.EndsWith('/') ? endpoint : endpoint + "/";
        var requestUri = new Uri(new Uri(baseUri), $"openai/deployments/{deployment}/chat/completions?api-version=2024-08-01-preview");

        var payload = new
        {
            temperature = 0.35,
            max_tokens = 1200,
            response_format = new
            {
                type = "json_schema",
                json_schema = new
                {
                    name = "storyboard_package",
                    schema = GenerationJsonSchema.Value
                }
            },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = "You are an Azure learning consultant. Produce engaging storyboards and quizzes derived from source text."
                },
                new
                {
                    role = "user",
                    content = $"SOURCE DOCUMENT BEGIN\n{Truncate(documentText, 6000)}\nSOURCE DOCUMENT END"
                }
            }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("api-key", apiKey);

        using var response = await HttpClient.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("[ProcessKTDocument] Azure OpenAI HTTP {Status}: {Body}", response.StatusCode, body);
            return null;
        }

        var raw = await response.Content.ReadAsStringAsync();
        var parsed = TryParseAoaiResponse(raw);
        return parsed;
    }

    private static GenerationResult? TryParseAoaiResponse(string raw)
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

            return JsonSerializer.Deserialize<GenerationResult>(assistantText, new JsonSerializerOptions
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
        => string.IsNullOrEmpty(input) ? input : (input.Length <= max ? input : input[..max]);

    private static string CreateTitleFromText(string text, int idx)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return $"Key Insight {idx + 1}";
        }

        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => new string(w.Where(char.IsLetterOrDigit).ToArray()))
            .Where(w => !string.IsNullOrWhiteSpace(w))
            .Take(6)
            .ToList();

        if (!words.Any())
        {
            return $"Key Insight {idx + 1}";
        }

        var normalized = words.Select(w => w.ToLowerInvariant()).ToList();
        var titleWords = normalized.Select(w =>
        {
            if (w.Length == 0) return string.Empty;
            if (w.Length == 1) return w.ToUpperInvariant();
            return char.ToUpperInvariant(w[0]) + w[1..];
        }).Where(w => !string.IsNullOrWhiteSpace(w));

        var assembled = string.Join(' ', titleWords);
        return string.IsNullOrWhiteSpace(assembled) ? $"Key Insight {idx + 1}" : assembled;
    }

    private async Task UploadJsonAsync(string containerName, string blobName, object payload)
    {
        var container = _blobServiceClient.GetBlobContainerClient(containerName);
        await container.CreateIfNotExistsAsync(PublicAccessType.None);
        var blob = container.GetBlobClient(blobName);
        using var ms = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(payload, new JsonSerializerOptions { WriteIndented = true }));
        await blob.UploadAsync(ms, overwrite: true);
    }

    private record GenerationResult
    {
        [JsonPropertyName("summary")] public string Summary { get; init; } = string.Empty;
        [JsonPropertyName("scenes")] public List<AoaiScene> Scenes { get; init; } = new();
        [JsonPropertyName("quiz")] public List<AoaiQuizItem> Quiz { get; init; } = new();
    }

    private record AoaiScene
    {
        [JsonPropertyName("title")] public string? Title { get; init; }
        [JsonPropertyName("narration")] public string? Narration { get; init; }
        [JsonPropertyName("keywords")] public List<string>? Keywords { get; init; }
        [JsonPropertyName("visualPrompt")] public string? VisualPrompt { get; init; }
        [JsonPropertyName("badge")] public string? Badge { get; init; }
        [JsonPropertyName("imageUrl")] public string? ImageUrl { get; init; }
        [JsonPropertyName("imageAlt")] public string? ImageAlt { get; init; }
    }

    private record AoaiQuizItem
    {
        [JsonPropertyName("id")] public string? Id { get; init; }
        [JsonPropertyName("question")] public string Question { get; init; } = string.Empty;
        [JsonPropertyName("options")] public List<string> Options { get; init; } = new();
        [JsonPropertyName("correctIndex")] public int CorrectIndex { get; init; }
        [JsonPropertyName("explanation")] public string? Explanation { get; init; }
    }

    private class SceneData
    {
        public int Index { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Narration { get; set; } = string.Empty;
        public List<string> Keywords { get; set; } = new();
        public string? Badge { get; set; }
        public string? VisualPrompt { get; set; }
        public string? ImageUrl { get; set; }
        public string? ImageAlt { get; set; }

        public static SceneData FromGeneration(AoaiScene scene, int idx)
        {
            var narration = string.IsNullOrWhiteSpace(scene.Narration) ? scene.Title ?? string.Empty : scene.Narration;
            return new SceneData
            {
                Index = idx + 1,
                Title = string.IsNullOrWhiteSpace(scene.Title) ? CreateTitleFromText(narration, idx) : scene.Title.Trim(),
                Narration = narration?.Trim() ?? string.Empty,
                Keywords = (scene.Keywords ?? new List<string>()).Where(k => !string.IsNullOrWhiteSpace(k)).Select(k => k.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Take(6).ToList(),
                Badge = string.IsNullOrWhiteSpace(scene.Badge) ? null : scene.Badge?.Trim(),
                VisualPrompt = scene.VisualPrompt,
                ImageUrl = scene.ImageUrl,
                ImageAlt = scene.ImageAlt
            };
        }

        public static SceneData FromFallback(string text, int idx)
        {
            return new SceneData
            {
                Index = idx + 1,
                Title = CreateTitleFromText(text, idx),
                Narration = text,
                Keywords = GuessKeywords(text),
                Badge = idx switch
                {
                    0 => "Overview",
                    1 => "Deep Dive",
                    2 => "Benefits",
                    _ => null
                }
            };
        }

        public string CreateDefaultVisualPrompt()
        {
            var primary = Keywords.FirstOrDefault() ?? Title;
            return $"Isometric professional illustration depicting {primary} concept, modern azure cloud theme, high contrast lighting, no text overlay.";
        }

        private static List<string> GuessKeywords(string text)
        {
            return text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Select(w => new string(w.Where(char.IsLetterOrDigit).ToArray()))
                .Where(w => w.Length > 3)
                .Select(w => w.ToLowerInvariant())
                .Distinct()
                .Take(5)
                .ToList();
        }
    }

    private class QuizQuestion
    {
        public string Id { get; }
        public string Text { get; }
        public List<string> Options { get; }
        public int CorrectIndex { get; }
        public string? Explanation { get; }

        public QuizQuestion(string id, string text, List<string> options, int correctIndex, string? explanation = null)
        {
            Id = id;
            Text = text;
            Options = options;
            CorrectIndex = correctIndex;
            Explanation = explanation;
        }

        public static QuizQuestion FromGeneration(AoaiQuizItem item, int idx)
        {
            var options = item.Options?.Where(o => !string.IsNullOrWhiteSpace(o)).Select(o => o.Trim()).ToList() ?? new List<string>();
            if (options.Count < 4)
            {
                while (options.Count < 4)
                {
                    options.Add(options.Count switch
                    {
                        0 => "Not specified",
                        1 => "Configuration detail",
                        2 => "Best practice",
                        _ => "Review documentation"
                    });
                }
            }
            var index = Math.Clamp(item.CorrectIndex, 0, options.Count - 1);
            var text = string.IsNullOrWhiteSpace(item.Question) ? "Which statement best matches the training content?" : item.Question.Trim();
            return new QuizQuestion(item.Id ?? $"q{idx + 1}", text, options, index, item.Explanation);
        }
    }

    private static readonly Lazy<object> GenerationJsonSchema = new(() => new
    {
        type = "object",
        required = new[] { "summary", "scenes", "quiz" },
        properties = new Dictionary<string, object>
        {
            ["summary"] = new { type = "string", maxLength = 250 },
            ["scenes"] = new
            {
                type = "array",
                minItems = 3,
                maxItems = 6,
                items = new
                {
                    type = "object",
                    required = new[] { "title", "narration" },
                    properties = new Dictionary<string, object>
                    {
                        ["title"] = new { type = "string", maxLength = 120 },
                        ["narration"] = new { type = "string", maxLength = 400 },
                        ["keywords"] = new { type = "array", items = new { type = "string" }, maxItems = 6 },
                        ["visualPrompt"] = new { type = "string" },
                        ["badge"] = new { type = "string", maxLength = 40 },
                        ["imageUrl"] = new { type = "string" },
                        ["imageAlt"] = new { type = "string" }
                    }
                }
            },
            ["quiz"] = new
            {
                type = "array",
                minItems = 3,
                maxItems = 6,
                items = new
                {
                    type = "object",
                    required = new[] { "question", "options", "correctIndex" },
                    properties = new Dictionary<string, object>
                    {
                        ["id"] = new { type = "string" },
                        ["question"] = new { type = "string", maxLength = 200 },
                        ["options"] = new { type = "array", minItems = 4, maxItems = 4, items = new { type = "string", maxLength = 120 } },
                        ["correctIndex"] = new { type = "integer", minimum = 0, maximum = 3 },
                        ["explanation"] = new { type = "string" }
                    }
                }
            }
        }
    });
}
