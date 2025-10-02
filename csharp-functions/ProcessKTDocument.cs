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
using System.Text.RegularExpressions;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KTStudio.Functions;

public class ProcessKTDocument
{
    // Build marker (forces function re-registration on deployment). Update value to trigger Azure host reload.
    private static readonly string BuildMarker = "RebindMarker_2025-10-02T07:15Z"; // bump timestamp for redeploy
    private static readonly HttpClient HttpClient = new();
    private static readonly string[] StopWords = new[]
    {
        "the","and","that","this","with","from","into","your","their","about","across","through","while","where","when","which","what","have","will","should","could","would","been","being","after","before","under","over","once","each","other","those","these","ever","such","here","there","also","using","within","without","between","across"
    };

    private static readonly IReadOnlyList<VideoStyleProfile> VideoStyles = new List<VideoStyleProfile>
    {
        new("Process Workflow",
            keywords: new[] {"pipeline","process","workflow","stage","automation","continuous","deployment","delivery","devops","release"},
            visualStyle: "dynamic process visualization with sequential panels, animated connectors, and bold callouts for each stage",
            motion: "camera tracks along the pipeline with smooth parallax, emphasizing flow between checkpoints",
            lighting: "electric teal and indigo lighting with illuminated arrows",
            avoid: "static blueprint grids; keep energy high and kinetic"),
        new("Cloud Architecture",
            keywords: new[] {"architecture","infrastructure","network","topology","server","microservice","component","azure","cloud"},
            visualStyle: "clean modern infrastructure map with layered cloud services and labeled nodes",
            motion: "slow orbital moves around clusters with zoom-ins on critical services",
            lighting: "crisp cool lighting with subtle grid glow",
            avoid: "generic stock footage or character animation"),
        new("Security & Compliance",
            keywords: new[] {"security","risk","compliance","policy","access","governance","identity","threat","zero","trust"},
            visualStyle: "cybersecurity control room aesthetic with shields, locks, and segmented zones",
            motion: "tight push-ins on defense layers with particle shield effects",
            lighting: "deep sapphire and neon accents",
            avoid: "playful or whimsical motifs"),
        new("Data & Analytics",
            keywords: new[] {"data","analytics","insight","metric","dashboard","kpi","report","visualization","telemetry"},
            visualStyle: "floating analytic dashboards with holographic charts and data streams",
            motion: "camera weaves between panels with depth-of-field shifts",
            lighting: "vibrant aqua and magenta gradients",
            avoid: "flat 2D diagram looks; keep elements volumetric"),
        new("Team Enablement",
            keywords: new[] {"team","training","collaboration","onboarding","knowledge","stakeholder","workshop","communication","culture"},
            visualStyle: "story-driven explainer with stylized avatars, callout bubbles, and shared workspaces",
            motion: "camera transitions between collaborative scenes and shared canvases",
            lighting: "warm spotlight with optimistic accents",
            avoid: "overly technical schematics; highlight human collaboration"),
        new("Business Strategy",
            keywords: new[] {"strategy","roadmap","initiative","investment","value","portfolio","market","financial","revenue","goal"},
            visualStyle: "executive briefing visuals with layered timelines, milestones, and outcome dashboards",
            motion: "sweeping moves across timelines with highlight pulses on KPIs",
            lighting: "sleek slate background with gold accents",
            avoid: "engineering-heavy motifs"),
        new("Operations",
            keywords: new[] {"operation","support","maintenance","incident","monitoring","service","sla","uptime","ticket"},
            visualStyle: "control center dashboards showing runbooks, alerts, and remediation swimlanes",
            motion: "camera pans across status walls with alert zooms",
            lighting: "cool neutral palette with alert highlights",
            avoid: "character animation; keep focus on systems"),
        new("Intelligent Automation",
            keywords: new[] {"automation","ai","machine","learning","model","intelligence","predictive","bot","agent"},
            visualStyle: "futuristic AI orchestration layers with flowing neural arcs and decision nodes",
            motion: "circular dolly moves through interconnected AI nodes",
            lighting: "glowing violet and cyan gradients",
            avoid: "rigid grid visuals"),
        new("Default Explainer",
            keywords: Array.Empty<string>(),
            visualStyle: "cinematic explainer with floating UI layers, subtle parallax, and narrative emphasis",
            motion: "camera glides between concepts with tasteful depth shifts",
            lighting: "balanced neutral lighting with accent highlights",
            avoid: "blueprint grids unless explicitly mentioned")
    };

    private static readonly HashSet<string> StopWordSet = new(StopWords, StringComparer.OrdinalIgnoreCase);

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
        _logger.LogInformation("[ProcessKTDocument] Triggered for blob Name={Name} Uri={Uri} BuildMarker={BuildMarker}", name, blobClient.Uri, BuildMarker);
        var swTotal = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            var downloadInfo = await blobClient.DownloadContentAsync();
            var content = downloadInfo.Value.Content.ToString();
            await ProcessContentAsync(name, content, swTotal);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ProcessKTDocument] Error processing blob {Name}", name);
            throw;
        }
    }

    public async Task ProcessContentAsync(string name, string content, System.Diagnostics.Stopwatch? sw = null)
    {
        sw ??= System.Diagnostics.Stopwatch.StartNew();
        var (summary, scenes, quiz, videoAsset) = await GenerateContentAsync(name, content);

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
            }),
            videoGenerationAttempted = videoAsset.Status != "skipped" || !string.IsNullOrWhiteSpace(videoAsset.Error),
            videoAsset = new
            {
                status = videoAsset.Status,
                mp4Url = videoAsset.Mp4Url,
                thumbnailUrl = videoAsset.ThumbnailUrl,
                durationSeconds = videoAsset.DurationSeconds > 0
                    ? Math.Round(videoAsset.DurationSeconds, 1)
                    : (double?)null,
                prompt = videoAsset.Prompt,
                operationId = videoAsset.RawOperationId,
                sourceUrl = videoAsset.SourceUrl,
                thumbnailSourceUrl = videoAsset.ThumbnailSourceUrl,
                error = videoAsset.Error,
                contentType = videoAsset.ContentType,
                byteLength = videoAsset.ByteLength,
                containerFourCc = videoAsset.ContainerFourCc,
                majorBrand = videoAsset.MajorBrand,
                hexPrefix = videoAsset.HexPrefix
            }
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

        sw.Stop();
        _logger.LogInformation("[ProcessKTDocument] Generated video & quiz artifacts for {Doc} in {ElapsedMs} ms (Scenes={Scenes} Quiz={Quiz} VideoStatus={VideoStatus})", name, sw.ElapsedMilliseconds, scenes.Count, quiz.Count, videoAsset.Status);
    }

    private async Task<(string Summary, List<SceneData> Scenes, List<QuizQuestion> Quiz, VideoAsset Asset)> GenerateContentAsync(string docName, string documentText)
    {
        var endpoint = _config["AzureOpenAI:Endpoint"] ?? _config["AzureOpenAI__Endpoint"];
        var apiKey = _config["AzureOpenAI:ApiKey"] ?? _config["AzureOpenAI__ApiKey"];
        var deployment = _config["AzureOpenAI:Deployment"] ?? _config["AzureOpenAI__Deployment"];

        GenerationResult? generated = null;
        var spec = DetermineGenerationSpec(documentText);

        if (!string.IsNullOrWhiteSpace(endpoint) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(deployment))
        {
            try
            {
                generated = await TryGenerateWithAzureOpenAi(endpoint, apiKey, deployment, documentText, spec);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[ProcessKTDocument] Azure OpenAI generation failed; using fallback.");
            }
        }

        List<SceneData> scenes;
        List<QuizQuestion> quiz;
        string summary;

        var docLabel = Path.GetFileNameWithoutExtension(docName);

        if (generated != null && generated.Scenes.Any() && generated.Quiz.Any())
        {
            summary = generated.Summary;
            scenes = generated.Scenes.Select((scene, idx) => SceneData.FromGeneration(scene, idx, summary, docLabel)).ToList();
            quiz = generated.Quiz.Select((q, idx) => QuizQuestion.FromGeneration(q, idx)).ToList();
        }
        else
        {
            (summary, scenes, quiz) = BuildFallbackContent(documentText, docLabel, spec);
        }

        await PopulateSceneImagesAsync(docName, scenes);

        var videoAsset = await GenerateVideoAssetAsync(docName, summary, scenes);

        return (summary, scenes, quiz, videoAsset);
    }

    private (string Summary, List<SceneData> Scenes, List<QuizQuestion> Quiz) BuildFallbackContent(string documentText, string docName, GenerationSpec spec)
    {
        var paragraphs = documentText.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Trim())
            .Where(p => p.Length > 25)
            .Distinct()
            .Take(spec.TargetSceneCount)
            .ToList();

        if (paragraphs.Count == 0)
        {
            paragraphs.Add("The uploaded document did not contain enough readable text to generate a storyboard. Add richer descriptions to unlock full AI visuals.");
        }

        var summarySource = paragraphs.First();
        var summary = summarySource.Length > 160 ? summarySource[..160] + "..." : summarySource;

        var scenes = paragraphs.Select((text, idx) => SceneData.FromFallback(text, idx, summary, docName)).ToList();

        var quiz = BuildFallbackQuiz(paragraphs, scenes, spec.TargetQuizCount);

        return (summary, scenes, quiz);
    }

    private GenerationSpec DetermineGenerationSpec(string documentText)
    {
        var wordCount = string.IsNullOrWhiteSpace(documentText)
            ? 0
            : documentText.Split(new[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries).Length;

        int targetScenes = wordCount switch
        {
            <= 350 => 3,
            <= 650 => 4,
            <= 950 => 5,
            _ => 6
        };

        int targetQuiz = Math.Clamp((int)Math.Round(targetScenes * 1.2, MidpointRounding.AwayFromZero), 3, 6);

        return new GenerationSpec(targetScenes, targetQuiz, wordCount);
    }

    private List<QuizQuestion> BuildFallbackQuiz(List<string> paragraphs, List<SceneData> scenes, int targetCount)
    {
        var questions = new List<QuizQuestion>();
        var opening = paragraphs.FirstOrDefault() ?? "the uploaded document";
        var topicOptions = BuildTopicOptions(opening);
        questions.Add(new QuizQuestion("q1", "What is the central topic highlighted in this training asset?", topicOptions, 0, "Review the first section of the document."));

        int nextIndex = 2;
        foreach (var scene in scenes.Take(Math.Max(0, targetCount - 2)))
        {
            var distractors = scenes.Where(s => !ReferenceEquals(s, scene)).Select(s => Truncate(s.Narration, 90)).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().Take(3).ToList();
            var options = new List<string> { Truncate(scene.Narration, 90) };
            options.AddRange(distractors);
            while (options.Count < 4)
            {
                options.Add("Refer to earlier sections of the document.");
            }
            questions.Add(new QuizQuestion($"q{nextIndex}", $"Which description best matches the scene \"{scene.Title}\"?", options, 0, "This scene summarises the key idea."));
            nextIndex++;
            if (questions.Count >= targetCount - 1)
            {
                break;
            }
        }

        if (questions.Count < targetCount)
        {
            var countOptions = new List<string> { "One", "Two", "Three", "More than three" };
            var correct = scenes.Count switch
            {
                <= 1 => 0,
                2 => 1,
                3 => 2,
                _ => 3
            };
            questions.Add(new QuizQuestion($"q{nextIndex}", "How many major concepts were emphasized?", countOptions, correct, "Each scene points to a core concept."));
            nextIndex++;
        }

        if (questions.Count < targetCount)
        {
            var providerOptions = new List<string> { "Azure OpenAI", "Azure Storage", "Azure Event Grid", "Azure Monitor" };
            questions.Add(new QuizQuestion($"q{nextIndex}", "Which Azure service powers the AI storyboard generation?", providerOptions, 0, "Azure OpenAI transforms documents into multimedia output."));
        }

        return questions;
    }

    private static List<string> BuildTopicOptions(string text)
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
                1 => "Architecture",
                2 => "Operations",
                _ => "Summary"
            });
        }
        return words;

        static string Clean(string token) => new string(token.Where(char.IsLetterOrDigit).ToArray());
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

        var size = DetermineImageSize(imageDeployment);

        for (var i = 0; i < scenes.Count; i++)
        {
            var scene = scenes[i];
            if (!string.IsNullOrWhiteSpace(scene.ImageUrl)) continue;
            var prompt = scene.ResolveVisualPrompt();
            if (string.IsNullOrWhiteSpace(prompt)) continue;

            try
            {
                var bytes = await GenerateImageBytesAsync(endpoint, apiKey, imageDeployment, prompt, size);
                if (bytes == null || bytes.Length == 0)
                {
                    continue;
                }
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

    private static string DetermineImageSize(string deployment)
    {
        return UsesAsyncImageGeneration(deployment) ? "1024x1024" : "832x468";
    }

    private static bool UsesAsyncImageGeneration(string? deployment)
    {
        if (string.IsNullOrWhiteSpace(deployment)) return false;
        return deployment.Contains("dall", StringComparison.OrdinalIgnoreCase) || deployment.Contains("sora", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<byte[]?> GenerateImageBytesAsync(string endpoint, string apiKey, string deployment, string prompt, string size)
    {
        var baseUri = endpoint.EndsWith('/') ? endpoint : endpoint + "/";
        if (UsesAsyncImageGeneration(deployment))
        {
            return await GenerateImageBytesAsyncLongRunning(baseUri, apiKey, deployment, prompt, size);
        }
        else
        {
            return await GenerateImageBytesAsyncImmediate(baseUri, apiKey, deployment, prompt, size);
        }
    }

    private async Task<byte[]?> GenerateImageBytesAsyncImmediate(string baseEndpoint, string apiKey, string deployment, string prompt, string size)
    {
        var requestUri = new Uri(new Uri(baseEndpoint), $"openai/deployments/{deployment}/images/generations?api-version=2024-02-15-preview");
        var payload = new
        {
            prompt,
            size,
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
            _logger.LogWarning("[ProcessKTDocument] Image generation failed (sync) HTTP {Status}: {Body}", response.StatusCode, body);
            return null;
        }

        var raw = await response.Content.ReadAsStringAsync();
        var payloadInfo = TryExtractImagePayload(raw);
        if (payloadInfo == null)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(payloadInfo.Base64))
        {
            return Convert.FromBase64String(payloadInfo.Base64);
        }

        if (!string.IsNullOrWhiteSpace(payloadInfo.Url))
        {
            return await HttpClient.GetByteArrayAsync(payloadInfo.Url);
        }

        return null;
    }

    private async Task<byte[]?> GenerateImageBytesAsyncLongRunning(string baseEndpoint, string apiKey, string deployment, string prompt, string size)
    {
        var submitUri = new Uri(new Uri(baseEndpoint), $"openai/deployments/{deployment}/images/generations:submit?api-version=2024-02-15-preview");
        var payload = new
        {
            prompt,
            size,
            n = 1,
            response_format = "b64_json"
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, submitUri)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("api-key", apiKey);

        using var response = await HttpClient.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("[ProcessKTDocument] Image generation submit failed (async) HTTP {Status}: {Body}", response.StatusCode, body);
            return null;
        }

        var operationLocation = response.Headers.TryGetValues("operation-location", out var values)
            ? values.FirstOrDefault()
            : null;

        if (string.IsNullOrWhiteSpace(operationLocation))
        {
            // Some deployments may still return inline response
            var inlineRaw = await response.Content.ReadAsStringAsync();
            var inlinePayload = TryExtractImagePayload(inlineRaw);
            if (inlinePayload?.Base64 != null)
            {
                return Convert.FromBase64String(inlinePayload.Base64);
            }
            if (!string.IsNullOrWhiteSpace(inlinePayload?.Url))
            {
                return await HttpClient.GetByteArrayAsync(inlinePayload.Url);
            }
            _logger.LogWarning("[ProcessKTDocument] Async image generation returned no operation-location header.");
            return null;
        }

        var operationUri = operationLocation.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? new Uri(operationLocation)
            : new Uri(new Uri(baseEndpoint), operationLocation);

        return await PollImageOperationAsync(operationUri, apiKey);
    }

    private async Task<byte[]?> PollImageOperationAsync(Uri operationUri, string apiKey)
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(Math.Min(2 + attempt, 10)));

            using var request = new HttpRequestMessage(HttpMethod.Get, operationUri);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Add("api-key", apiKey);

            using var response = await HttpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("[ProcessKTDocument] Image operation poll failed HTTP {Status}: {Body}", response.StatusCode, body);
                return null;
            }

            var raw = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("status", out var statusProp))
            {
                continue;
            }

            var status = statusProp.GetString();
            if (string.Equals(status, "succeeded", StringComparison.OrdinalIgnoreCase))
            {
                if (!doc.RootElement.TryGetProperty("result", out var result) || !result.TryGetProperty("data", out var dataArray) || dataArray.GetArrayLength() == 0)
                {
                    _logger.LogWarning("[ProcessKTDocument] Image generation succeeded but returned no data.");
                    return null;
                }

                var payload = dataArray[0];
                if (payload.TryGetProperty("b64_json", out var b64Element) && !string.IsNullOrWhiteSpace(b64Element.GetString()))
                {
                    return Convert.FromBase64String(b64Element.GetString()!);
                }

                if (payload.TryGetProperty("url", out var urlElement) && !string.IsNullOrWhiteSpace(urlElement.GetString()))
                {
                    return await HttpClient.GetByteArrayAsync(urlElement.GetString()!);
                }

                return null;
            }

            if (string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase))
            {
                var error = doc.RootElement.TryGetProperty("error", out var errorProp) ? errorProp.ToString() : "unknown";
                _logger.LogWarning("[ProcessKTDocument] Image generation operation reported failure: {Error}", error);
                return null;
            }
        }

        _logger.LogWarning("[ProcessKTDocument] Image generation operation timed out.");
        return null;
    }

    private static ImagePayload? TryExtractImagePayload(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("data", out var dataArray) || dataArray.GetArrayLength() == 0)
            {
                return null;
            }
            var item = dataArray[0];
            string? base64 = null;
            string? url = null;
            if (item.TryGetProperty("b64_json", out var b64Element))
            {
                base64 = b64Element.GetString();
            }
            if (item.TryGetProperty("url", out var urlElement))
            {
                url = urlElement.GetString();
            }

            if (string.IsNullOrWhiteSpace(base64) && string.IsNullOrWhiteSpace(url))
            {
                return null;
            }

            return new ImagePayload(base64, url);
        }
        catch
        {
            return null;
        }
    }

    private record ImagePayload(string? Base64, string? Url);

    private async Task<VideoAsset> GenerateVideoAssetAsync(string docName, string summary, List<SceneData> scenes)
    {
        if (scenes == null || scenes.Count == 0)
        {
            return VideoAsset.Skipped("No scenes were generated, so video creation was skipped.");
        }

        var videoDeployment = _config["AzureOpenAI:VideoDeployment"] ?? _config["AzureOpenAI__VideoDeployment"];
        if (string.IsNullOrWhiteSpace(videoDeployment))
        {
            _logger.LogInformation("[ProcessKTDocument] Video generation skipped: AzureOpenAI:VideoDeployment not configured.");
            return VideoAsset.Skipped("Video deployment not configured.");
        }

        var endpoint = _config["AzureOpenAI:Endpoint"] ?? _config["AzureOpenAI__Endpoint"];
        var apiKey = _config["AzureOpenAI:ApiKey"] ?? _config["AzureOpenAI__ApiKey"];

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(apiKey))
        {
            _logger.LogWarning("[ProcessKTDocument] Video generation skipped due to missing endpoint or API key.");
            return VideoAsset.Skipped("Video endpoint or API key missing.");
        }

        var docLabel = Path.GetFileNameWithoutExtension(docName);
        var prompt = BuildVideoPrompt(docLabel, summary, scenes);
        if (string.IsNullOrWhiteSpace(prompt))
        {
            return VideoAsset.Skipped("Unable to compose a video prompt.");
        }

        try
        {
            var baseEndpoint = endpoint.EndsWith('/') ? endpoint : endpoint + "/";
            var targetDuration = DetermineVideoDurationSeconds(scenes.Count);
            _logger.LogInformation("[ProcessKTDocument] VideoGen starting Deployment={Deployment} Scenes={Scenes} TargetDuration={Duration}s PromptChars={PromptChars}", videoDeployment, scenes.Count, targetDuration, prompt.Length);
            _logger.LogDebug("[ProcessKTDocument] VideoGen prompt preview: {Preview}", prompt.Length > 280 ? prompt[..280] + "..." : prompt);
            var payload = await SubmitVideoGenerationAsync(baseEndpoint, apiKey, videoDeployment, prompt, targetDuration);

            if (payload.VideoBytes == null || payload.VideoBytes.Length == 0)
            {
                _logger.LogWarning("[ProcessKTDocument] Video generation returned an empty payload (Deployment={Deployment}).", videoDeployment);
                throw new VideoGenerationException("Video generation returned an empty payload from Azure OpenAI.");
            }

            var inspection = InspectVideoBytes(payload.VideoBytes);
            _logger.LogInformation(
                "[ProcessKTDocument] Video payload inspection size={Size} box={Box} majorBrand={Major} contentType={ContentType} sourceUrl={SourceUrl}",
                inspection.ByteLength,
                inspection.BoxFourCc ?? "(null)",
                inspection.MajorBrand ?? "(null)",
                payload.ContentType ?? "(unknown)",
                payload.SourceUrl ?? "(inline)"
            );
            if (!inspection.IsLikelyMp4)
            {
                _logger.LogWarning(
                    "[ProcessKTDocument] Video payload bytes are not recognised as MP4 (box={Box}, prefix={Prefix}). Playback may fail.",
                    inspection.BoxFourCc ?? "(null)",
                    inspection.HexPrefix
                );
            }

            var clipUrl = await UploadVideoClipAsync(docName, payload.VideoBytes, payload.ContentType ?? "video/mp4");
            if (string.IsNullOrWhiteSpace(clipUrl))
            {
                return VideoAsset.Failed("Unable to upload generated video clip to storage.");
            }

            string? thumbnailUrl = null;
            if (payload.ThumbnailBytes != null && payload.ThumbnailBytes.Length > 0)
            {
                thumbnailUrl = await UploadVideoThumbnailAsync(docName, payload.ThumbnailBytes, payload.ThumbnailContentType ?? "image/png");
            }

            if (string.IsNullOrWhiteSpace(thumbnailUrl))
            {
                thumbnailUrl = scenes.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s.ImageUrl))?.ImageUrl;
            }

            return VideoAsset.Success(
                clipUrl,
                thumbnailUrl,
                payload.DurationSeconds ?? targetDuration,
                prompt,
                payload.OperationId,
                payload.SourceUrl,
                payload.ThumbnailSourceUrl,
                payload.ContentType,
                inspection.ByteLength,
                inspection.BoxFourCc,
                inspection.MajorBrand,
                inspection.HexPrefix
            );
        }
        catch (VideoGenerationException vgex)
        {
            _logger.LogWarning("[ProcessKTDocument] Video generation failed for {Doc}: {Message}", docName, vgex.Message);
            return VideoAsset.Failed(vgex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[ProcessKTDocument] Azure OpenAI video generation failed for {Doc}", docName);
            return VideoAsset.Failed(ex.Message);
        }
    }

    private async Task<VideoGenerationPayload?> SubmitVideoGenerationAsync(string baseEndpoint, string apiKey, string deployment, string prompt, double targetDurationSeconds)
    {
        var requestUri = new Uri(new Uri(baseEndpoint), $"openai/deployments/{deployment}/videos/generations:submit?api-version=2024-08-01-preview");
        var payload = new
        {
            input = prompt,
            duration = Math.Clamp((int)Math.Round(targetDurationSeconds), 20, 120),
            aspect_ratio = "16:9",
            format = "mp4"
        };

        var serialized = JsonSerializer.Serialize(payload);
        _logger.LogInformation("[ProcessKTDocument] Video submit -> {Uri} Deployment={Deployment} Duration={Duration}s PayloadBytes={Bytes} PromptChars={PromptChars}", requestUri, deployment, payload.duration, serialized.Length, prompt.Length);
        _logger.LogDebug("[ProcessKTDocument] Video submit payload snippet: {Snippet}", serialized.Length > 220 ? serialized[..220] + "..." : serialized);

        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
        {
            Content = new StringContent(serialized, Encoding.UTF8, "application/json")
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("api-key", apiKey);

        using var response = await HttpClient.SendAsync(request);
        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("[ProcessKTDocument] Video submit FAILED Status={Status} ({Reason}) BodySnippet={Snippet}", (int)response.StatusCode, response.ReasonPhrase, Truncate(responseBody, 600));
            throw new VideoGenerationException($"Submit failed HTTP {(int)response.StatusCode}: {Truncate(responseBody, 600)}");
        }

        _logger.LogInformation("[ProcessKTDocument] Video submit accepted Status={Status} BodyChars={Len}", (int)response.StatusCode, responseBody.Length);

        var operationLocation = response.Headers.TryGetValues("operation-location", out var values)
            ? values.FirstOrDefault()
            : null;

        if (string.IsNullOrWhiteSpace(operationLocation))
        {
            using var doc = JsonDocument.Parse(responseBody);
            return await TryExtractVideoPayloadAsync(doc, prompt);
        }

        var operationUri = operationLocation.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? new Uri(operationLocation)
            : new Uri(new Uri(baseEndpoint), operationLocation);

        return await PollVideoOperationAsync(operationUri, apiKey, prompt);
    }

    private async Task<VideoGenerationPayload?> PollVideoOperationAsync(Uri operationUri, string apiKey, string prompt)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(Math.Min(6 + attempt * 2, 24)));

            using var request = new HttpRequestMessage(HttpMethod.Get, operationUri);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Add("api-key", apiKey);

            using var response = await HttpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("[ProcessKTDocument] Video poll attempt={Attempt} FAILED Status={Status} BodySnippet={Snippet}", attempt + 1, (int)response.StatusCode, Truncate(body, 400));
                continue;
            }

            using var doc = JsonDocument.Parse(body);
            var status = doc.RootElement.TryGetProperty("status", out var statusElement)
                ? statusElement.GetString()
                : null;

            if (string.Equals(status, "running", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(status, "processing", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("[ProcessKTDocument] Video poll attempt={Attempt} status={Status} (continuing)", attempt + 1, status);
                continue;
            }

            if (string.Equals(status, "succeeded", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("[ProcessKTDocument] Video poll succeeded attempt={Attempt} extracting payload", attempt + 1);
                var payload = await TryExtractVideoPayloadAsync(doc, prompt);
                _logger.LogInformation("[ProcessKTDocument] Video payload extracted bytes={Bytes} duration={Duration}s", payload.VideoBytes?.Length, payload.DurationSeconds);
                return payload;
            }

            if (string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogError("[ProcessKTDocument] Video operation FAILED attempt={Attempt} BodySnippet={Snippet}", attempt + 1, Truncate(body, 600));
                throw new VideoGenerationException($"Video generation operation failed after {attempt + 1} polls: {Truncate(body, 600)}");
            }
        }

        _logger.LogWarning("[ProcessKTDocument] Video generation operation timed out.");
        throw new VideoGenerationException("Video generation operation timed out before completion.");
    }

    private async Task<VideoGenerationPayload> TryExtractVideoPayloadAsync(JsonDocument doc, string prompt)
    {
        var root = doc.RootElement;
        string? operationId = null;
        if (root.TryGetProperty("id", out var idEl))
        {
            operationId = idEl.GetString();
        }

        var resultElement = root;
        if (root.TryGetProperty("result", out var nestedResult))
        {
            resultElement = nestedResult;
        }

        if (resultElement.TryGetProperty("output", out var outputElement) && outputElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in outputElement.EnumerateArray())
            {
                string? contentType = item.TryGetProperty("content_type", out var ctEl) ? ctEl.GetString() : "video/mp4";
                double? duration = null;
                if (item.TryGetProperty("duration", out var durEl) && durEl.TryGetDouble(out var durValue))
                {
                    duration = durValue;
                }
                else if (item.TryGetProperty("length_seconds", out var lenEl) && lenEl.TryGetDouble(out var lenValue))
                {
                    duration = lenValue;
                }

                byte[]? videoBytes = null;
                string? sourceUrl = null;
                if (item.TryGetProperty("data", out var dataEl))
                {
                    var b64 = dataEl.GetString();
                    if (!string.IsNullOrWhiteSpace(b64))
                    {
                        try
                        {
                            videoBytes = Convert.FromBase64String(b64);
                        }
                        catch (FormatException)
                        {
                            videoBytes = null;
                        }
                    }
                }

                if (videoBytes == null && item.TryGetProperty("url", out var urlEl))
                {
                    sourceUrl = urlEl.GetString();
                    if (!string.IsNullOrWhiteSpace(sourceUrl))
                    {
                        try
                        {
                            videoBytes = await HttpClient.GetByteArrayAsync(sourceUrl);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "[ProcessKTDocument] Unable to download video asset from {Url}", sourceUrl);
                        }
                    }
                }

                if (videoBytes == null)
                {
                    continue;
                }

                byte[]? thumbnailBytes = null;
                string? thumbnailContentType = null;
                string? thumbnailSourceUrl = null;

                if (resultElement.TryGetProperty("thumbnails", out var thumbnailsElement) && thumbnailsElement.ValueKind == JsonValueKind.Array)
                {
                    var thumbObject = thumbnailsElement.EnumerateArray().FirstOrDefault();
                    if (thumbObject.ValueKind == JsonValueKind.Object)
                    {
                        if (thumbObject.TryGetProperty("content_type", out var thumbCtEl))
                        {
                            thumbnailContentType = thumbCtEl.GetString();
                        }
                        if (thumbObject.TryGetProperty("data", out var thumbDataEl))
                        {
                            var thumbB64 = thumbDataEl.GetString();
                            if (!string.IsNullOrWhiteSpace(thumbB64))
                            {
                                try
                                {
                                    thumbnailBytes = Convert.FromBase64String(thumbB64);
                                }
                                catch (FormatException)
                                {
                                    thumbnailBytes = null;
                                }
                            }
                        }
                        if (thumbnailBytes == null && thumbObject.TryGetProperty("url", out var thumbUrlEl))
                        {
                            thumbnailSourceUrl = thumbUrlEl.GetString();
                            if (!string.IsNullOrWhiteSpace(thumbnailSourceUrl))
                            {
                                try
                                {
                                    thumbnailBytes = await HttpClient.GetByteArrayAsync(thumbnailSourceUrl);
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogWarning(ex, "[ProcessKTDocument] Unable to download video thumbnail from {Url}", thumbnailSourceUrl);
                                }
                            }
                        }
                    }
                }

                return new VideoGenerationPayload(videoBytes, contentType, thumbnailBytes, thumbnailContentType, duration, prompt, operationId, sourceUrl, thumbnailSourceUrl);
            }
        }

        throw new VideoGenerationException("Video generation result did not include a downloadable video asset.");
    }

    private async Task<string?> UploadVideoClipAsync(string docName, byte[] bytes, string contentType)
    {
        if (bytes == null || bytes.Length == 0)
        {
            return null;
        }

        var container = _blobServiceClient.GetBlobContainerClient("generated-video-files");
        await container.CreateIfNotExistsAsync(PublicAccessType.Blob);

        var docBase = Path.GetFileNameWithoutExtension(docName);
        var safeDocBase = new string(docBase.Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray()).Trim('-');
        if (string.IsNullOrWhiteSpace(safeDocBase))
        {
            safeDocBase = "document";
        }

        var blobName = $"{safeDocBase}/clip.mp4";
        var blob = container.GetBlobClient(blobName);

        using (var ms = new MemoryStream(bytes))
        {
            await blob.UploadAsync(ms, overwrite: true);
        }

        await blob.SetHttpHeadersAsync(new BlobHttpHeaders { ContentType = contentType });

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

    private async Task<string?> UploadVideoThumbnailAsync(string docName, byte[] bytes, string contentType)
    {
        if (bytes == null || bytes.Length == 0)
        {
            return null;
        }

        var container = _blobServiceClient.GetBlobContainerClient("generated-video-files");
        await container.CreateIfNotExistsAsync(PublicAccessType.Blob);

        var docBase = Path.GetFileNameWithoutExtension(docName);
        var safeDocBase = new string(docBase.Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray()).Trim('-');
        if (string.IsNullOrWhiteSpace(safeDocBase))
        {
            safeDocBase = "document";
        }

        var extension = contentType switch
        {
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => "png"
        };

        var blobName = $"{safeDocBase}/thumbnail.{extension}";
        var blob = container.GetBlobClient(blobName);

        using (var ms = new MemoryStream(bytes))
        {
            await blob.UploadAsync(ms, overwrite: true);
        }

        await blob.SetHttpHeadersAsync(new BlobHttpHeaders { ContentType = contentType });

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

    private static double DetermineVideoDurationSeconds(int sceneCount)
    {
        var baseSeconds = Math.Max(1, sceneCount) * 12;
        return Math.Clamp((double)baseSeconds, 45d, 120d);
    }

    private static VideoBinaryInspection InspectVideoBytes(byte[] bytes)
    {
        if (bytes == null || bytes.Length == 0)
        {
            return new VideoBinaryInspection(false, null, null, string.Empty, 0);
        }

        string? box = null;
        if (bytes.Length >= 8)
        {
            box = Encoding.ASCII.GetString(bytes.AsSpan(4, Math.Min(4, bytes.Length - 4)));
        }

        string? majorBrand = null;
        if (bytes.Length >= 12)
        {
            majorBrand = Encoding.ASCII.GetString(bytes.AsSpan(8, Math.Min(4, bytes.Length - 8)));
        }

        var prefixBytes = bytes.Take(Math.Min(16, bytes.Length)).ToArray();
        var hexPrefix = BitConverter.ToString(prefixBytes);

        var isMp4 = string.Equals(box, "ftyp", StringComparison.OrdinalIgnoreCase);

        return new VideoBinaryInspection(isMp4, box, majorBrand, hexPrefix, bytes.LongLength);
    }

    private static string BuildVideoPrompt(string? docLabel, string summary, List<SceneData> scenes)
    {
        var builder = new StringBuilder();
        var topic = string.IsNullOrWhiteSpace(docLabel) ? "the solution" : docLabel.Replace('_', ' ').Replace('-', ' ');
        var hintTerms = scenes.SelectMany(s => s.Keywords ?? new List<string>())
            .Concat(scenes.Select(s => s.Title))
            .Concat(string.IsNullOrWhiteSpace(docLabel) ? Array.Empty<string>() : new[] { docLabel })
            .ToList();
        var combinedNarration = string.Join(" ", scenes.Select(s => s.Narration ?? string.Empty));
        var style = DetermineVideoStyle(hintTerms, summary, combinedNarration, docLabel);

        builder.AppendLine($"Produce a 16:9 cinematic video explaining {topic}. Emphasize a {style.VisualStyle}.");
        if (!string.IsNullOrWhiteSpace(summary))
        {
            builder.AppendLine("Narrative summary: " + summary.Trim());
        }
        builder.AppendLine("Camera direction: " + style.Motion + ".");
        builder.AppendLine("Lighting & palette: " + style.Lighting + ".");
        if (!string.IsNullOrWhiteSpace(style.Avoid))
        {
            builder.AppendLine("Avoid: " + style.Avoid + ".");
        }

        builder.AppendLine("Storyboard shots (follow this order, each bullet is a scene beat):");
        var index = 1;
        foreach (var scene in scenes.Take(8))
        {
            builder.Append("- Shot ");
            builder.Append(index++);
            builder.Append(": ");
            builder.AppendLine(scene.ToShotPrompt());
        }
        builder.AppendLine("Ensure transitions reinforce the " + style.StyleName + " theme and keep details accurate to the context.");
        return builder.ToString();
    }

    private async Task<GenerationResult?> TryGenerateWithAzureOpenAi(string endpoint, string apiKey, string deployment, string documentText, GenerationSpec spec)
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
                    content = $"You are an Azure learning consultant and visualization director. From any training document you must deliver a concise summary, exactly {spec.TargetSceneCount} storyboard scenes, and exactly {spec.TargetQuizCount} quiz questions. Each scene must include a `visualPrompt` describing a technical architecture or conceptual diagram that reflects the source material."
                },
                new
                {
                    role = "user",
                    content = $"Return JSON that matches the provided schema. Keep the summary under 250 characters. Craft each scene so the narration highlights the core concept and the visualPrompt requests a clean labeled diagram, blueprint, or schematic relevant to the training content. You must output exactly {spec.TargetSceneCount} scenes and {spec.TargetQuizCount} quiz questions, unless the source material is clearly too short to support them (in that case fall back to the maximum coherent number and explain in the summary). Quiz questions must be specific to the document and cover distinct ideas." 
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

        _logger.LogInformation("[ProcessKTDocument] AOAI Chat request -> {Uri} Deployment={Deployment} Scenes={Scenes} Quiz={Quiz} InputChars={Chars}", requestUri, deployment, spec.TargetSceneCount, spec.TargetQuizCount, documentText?.Length ?? 0);
        try
        {
            var stopwatch = Stopwatch.StartNew();
            using var response = await HttpClient.SendAsync(request);
            stopwatch.Stop();
            var status = (int)response.StatusCode;
            var responseBody = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("[ProcessKTDocument] AOAI Chat FAILED Status={Status} ({Reason}) ElapsedMs={Elapsed} BodySnippet={Snippet}", status, response.ReasonPhrase, stopwatch.ElapsedMilliseconds, Truncate(responseBody, 600));
                return null;
            }
            _logger.LogInformation("[ProcessKTDocument] AOAI Chat OK Status={Status} ElapsedMs={Elapsed} BodyChars={Len}", status, stopwatch.ElapsedMilliseconds, responseBody.Length);
            var parsed = TryParseAoaiResponse(responseBody);
            if (parsed == null)
            {
                _logger.LogWarning("[ProcessKTDocument] AOAI Chat parse returned null (possibly schema mismatch).");
            }
            return parsed;
        }
        catch (HttpRequestException hre)
        {
            _logger.LogError(hre, "[ProcessKTDocument] AOAI Chat HttpRequestException: {Message}", hre.Message);
            return null;
        }
        catch (TaskCanceledException tce)
        {
            _logger.LogError(tce, "[ProcessKTDocument] AOAI Chat timeout/canceled after sending request.");
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ProcessKTDocument] AOAI Chat unexpected exception.");
            return null;
        }
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

    private record VideoStyleProfile(string StyleName, string[] Keywords, string VisualStyle, string Motion, string Lighting, string Avoid);

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

    private class VideoAsset
    {
        public string Status { get; init; } = "skipped";
        public string? Mp4Url { get; init; }
        public string? ThumbnailUrl { get; init; }
        public double DurationSeconds { get; init; }
        public string? Prompt { get; init; }
        public string? RawOperationId { get; init; }
        public string? SourceUrl { get; init; }
        public string? ThumbnailSourceUrl { get; init; }
        public string? Error { get; init; }

        public string? ContentType { get; init; }
        public long? ByteLength { get; init; }
        public string? ContainerFourCc { get; init; }
        public string? MajorBrand { get; init; }
        public string? HexPrefix { get; init; }

        public static VideoAsset Success(string mp4Url, string? thumbnailUrl, double durationSeconds, string prompt, string? operationId, string? sourceUrl, string? thumbnailSourceUrl, string? contentType, long? byteLength, string? containerFourCc, string? majorBrand, string? hexPrefix)
        {
            return new VideoAsset
            {
                Status = "success",
                Mp4Url = mp4Url,
                ThumbnailUrl = thumbnailUrl,
                DurationSeconds = durationSeconds,
                Prompt = prompt,
                RawOperationId = operationId,
                SourceUrl = sourceUrl,
                ThumbnailSourceUrl = thumbnailSourceUrl,
                ContentType = contentType,
                ByteLength = byteLength,
                ContainerFourCc = containerFourCc,
                MajorBrand = majorBrand,
                HexPrefix = hexPrefix
            };
        }

        public static VideoAsset Skipped(string reason)
        {
            return new VideoAsset
            {
                Status = "skipped",
                Error = string.IsNullOrWhiteSpace(reason) ? "Video generation skipped." : reason
            };
        }

        public static VideoAsset Failed(string reason)
        {
            return new VideoAsset
            {
                Status = "failed",
                Error = string.IsNullOrWhiteSpace(reason) ? "Video generation failed." : reason
            };
        }
    }

    private class VideoGenerationException : Exception
    {
        public VideoGenerationException(string message) : base(message)
        {
        }
    }

    private record VideoGenerationPayload(byte[] VideoBytes, string? ContentType, byte[]? ThumbnailBytes, string? ThumbnailContentType, double? DurationSeconds, string Prompt, string? OperationId, string? SourceUrl, string? ThumbnailSourceUrl);

    private record VideoBinaryInspection(bool IsLikelyMp4, string? BoxFourCc, string? MajorBrand, string HexPrefix, long ByteLength);

    private record GenerationSpec(int TargetSceneCount, int TargetQuizCount, int WordCount);

    private static IEnumerable<string> ExtractTokens(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) yield break;

        foreach (var token in Regex.Split(text.ToLowerInvariant(), "[^a-z0-9]+").Where(t => t.Length > 2))
        {
            if (StopWordSet.Contains(token))
            {
                continue;
            }
            yield return token;
        }
    }

    private static VideoStyleProfile DetermineVideoStyle(IEnumerable<string>? keywordHints, string summary, string narration, string? docLabel)
    {
        var tokens = new List<string>();

        if (keywordHints != null)
        {
            foreach (var hint in keywordHints)
            {
                if (string.IsNullOrWhiteSpace(hint)) continue;
                tokens.AddRange(ExtractTokens(hint));
            }
        }

        tokens.AddRange(ExtractTokens(summary));
        tokens.AddRange(ExtractTokens(narration));
        tokens.AddRange(ExtractTokens(docLabel));

        if (tokens.Count == 0)
        {
            return VideoStyles.Last();
        }

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var token in tokens)
        {
            if (counts.TryGetValue(token, out var existing))
            {
                counts[token] = existing + 1;
            }
            else
            {
                counts[token] = 1;
            }
        }

        VideoStyleProfile best = VideoStyles.Last();
        var bestScore = 0;

        foreach (var style in VideoStyles)
        {
            if (style.Keywords.Length == 0)
            {
                continue;
            }

            var score = 0;
            foreach (var keyword in style.Keywords)
            {
                if (counts.TryGetValue(keyword, out var value))
                {
                    score += value;
                }
            }

            if (score > bestScore)
            {
                best = style;
                bestScore = score;
            }
        }

        return bestScore > 0 ? best : VideoStyles.Last();
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

        public string SummaryContext { get; set; } = string.Empty;
        public string? DocumentLabel { get; set; }

        public static SceneData FromGeneration(AoaiScene scene, int idx, string summary, string? docName)
        {
            var narration = string.IsNullOrWhiteSpace(scene.Narration) ? scene.Title ?? string.Empty : scene.Narration;
            var keywords = (scene.Keywords ?? new List<string>()).Where(k => !string.IsNullOrWhiteSpace(k)).Select(k => k.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Take(6).ToList();
            var data = new SceneData
            {
                Index = idx + 1,
                Title = string.IsNullOrWhiteSpace(scene.Title) ? CreateTitleFromText(narration, idx) : scene.Title.Trim(),
                Narration = narration?.Trim() ?? string.Empty,
                Keywords = keywords,
                Badge = string.IsNullOrWhiteSpace(scene.Badge) ? null : scene.Badge?.Trim(),
                ImageUrl = scene.ImageUrl,
                ImageAlt = scene.ImageAlt,
                SummaryContext = summary,
                DocumentLabel = docName
            };

            data.VisualPrompt = string.IsNullOrWhiteSpace(scene.VisualPrompt)
                ? ComposeVisualPrompt(docName, summary, data.Title, data.Narration, keywords)
                : scene.VisualPrompt!.Trim();

            return data;
        }

        public static SceneData FromFallback(string text, int idx, string summary, string? docName)
        {
            var title = CreateTitleFromText(text, idx);
            var keywords = GuessKeywords(text);
            return new SceneData
            {
                Index = idx + 1,
                Title = title,
                Narration = text,
                Keywords = keywords,
                Badge = idx switch
                {
                    0 => "Overview",
                    1 => "Deep Dive",
                    2 => "Benefits",
                    _ => null
                },
                SummaryContext = summary,
                DocumentLabel = docName,
                VisualPrompt = ComposeVisualPrompt(docName, summary, title, text, keywords)
            };
        }

        public string CreateDefaultVisualPrompt()
        {
            return ResolveVisualPrompt();
        }

        public string ResolveVisualPrompt()
        {
            if (!string.IsNullOrWhiteSpace(VisualPrompt))
            {
                return VisualPrompt!;
            }

            VisualPrompt = ComposeVisualPrompt(DocumentLabel, SummaryContext, Title, Narration, Keywords);
            return VisualPrompt!;
        }

        public string ToShotPrompt()
        {
            var builder = new StringBuilder();
            var heading = string.IsNullOrWhiteSpace(Title) ? $"Scene {Index}" : Title;
            builder.Append(heading);
            builder.Append(": ");
            builder.Append(Narration);
            if (Keywords.Any())
            {
                builder.Append(" | keywords: ");
                builder.Append(string.Join(", ", Keywords));
            }
            var visuals = ResolveVisualPrompt();
            if (!string.IsNullOrWhiteSpace(visuals))
            {
                builder.Append(" | visuals: ");
                builder.Append(visuals);
            }
            return builder.ToString();
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

        private static string ComposeVisualPrompt(string? docName, string summary, string title, string narration, List<string> keywords)
        {
            var focusTerms = keywords.Where(k => !string.IsNullOrWhiteSpace(k)).Take(5).ToList();
            if (!focusTerms.Any())
            {
                focusTerms.AddRange(GuessKeywords(narration).Take(5));
            }

            var focusText = focusTerms.Any() ? string.Join(", ", focusTerms) : title;
            var docLabel = string.IsNullOrWhiteSpace(docName) ? "the solution" : docName.Replace('_', ' ').Replace('-', ' ');

            var summarySnippet = summary;
            if (string.IsNullOrWhiteSpace(summarySnippet))
            {
                summarySnippet = narration;
            }
            summarySnippet = summarySnippet.Length > 220 ? summarySnippet[..220] + "..." : summarySnippet;

            var hintTerms = new List<string>();
            hintTerms.AddRange(keywords);
            hintTerms.Add(title);
            if (!string.IsNullOrWhiteSpace(docName))
            {
                hintTerms.Add(docName);
            }

            var style = DetermineVideoStyle(hintTerms, summarySnippet, narration, docName);

            return $"Create a cinematic scene that embodies {style.StyleName.ToLowerInvariant()} — {style.VisualStyle}. Spotlight {focusText}. Context: {summarySnippet}. Camera movement: {style.Motion}. Lighting: {style.Lighting}. Avoid {style.Avoid}.";
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
                    required = new[] { "title", "narration", "visualPrompt" },
                    properties = new Dictionary<string, object>
                    {
                        ["title"] = new { type = "string", maxLength = 120 },
                        ["narration"] = new { type = "string", maxLength = 400 },
                        ["keywords"] = new { type = "array", items = new { type = "string" }, maxItems = 6 },
                        ["visualPrompt"] = new { type = "string", minLength = 40, maxLength = 400 },
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
