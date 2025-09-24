using System.Text;
using Azure.AI.OpenAI;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Specialized;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Azure.Storage.Blobs.Models;
using System.Text.Json;

namespace KTStudio.Functions;

public class ProcessKTDocument
{
    private readonly OpenAIClient? _openAI;
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ILogger<ProcessKTDocument> _logger;
    private readonly IConfiguration _config;

    public ProcessKTDocument(OpenAIClient? openAI, BlobServiceClient blobServiceClient, ILogger<ProcessKTDocument> logger, IConfiguration config)
    {
        _openAI = openAI;
        _blobServiceClient = blobServiceClient;
        _logger = logger;
        _config = config;
    }

    [Function("ProcessKTDocument")]
    public async Task Run([BlobTrigger("uploaded-docs/{name}", Connection = "AzureWebJobsStorage")] BlobClient blobClient, string name)
    {
        _logger.LogInformation("Triggered ProcessKTDocument for blob: {BlobName}", name);

        // 1. Read blob contents
        string documentText = await ReadBlobTextAsync(blobClient);
        _logger.LogInformation("Read {Length} chars from document", documentText.Length);

        // 2. Generate script & quiz via Azure OpenAI (fallback if not configured)
        var generation = await GenerateContentAsync(documentText);

        // 3. Generate audio per scene
        var audioFiles = await GenerateAudioAsync(generation.ScriptScenes);

        // 4. Build video JSON & quiz JSON
        var videoJson = new
        {
            sourceDocument = name,
            summary = generation.Summary,
            scenes = generation.ScriptScenes.Select((s, i) => new { index = i + 1, text = s, audioFile = audioFiles.ElementAtOrDefault(i) }),
            createdUtc = DateTime.UtcNow,
            audioContainer = "generated-audio"
        };

        var quizJson = new
        {
            sourceDocument = name,
            createdUtc = DateTime.UtcNow,
            questions = generation.Quiz
        };

        // 5. Persist artifacts
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

    private async Task<(string Summary, List<string> ScriptScenes, List<object> Quiz)> GenerateContentAsync(string documentText)
    {
        var defaultResult = (Summary: "(OpenAI not configured) Sample summary.", ScriptScenes: new List<string>{"Scene 1 placeholder","Scene 2 placeholder"}, Quiz: new List<object>{ new { question = "Placeholder question?", options = new[]{"A","B","C","D"}, correctIndex = 1 } });

        if (_openAI == null)
            return defaultResult;

        try
        {
            var deployment = _config["AzureOpenAI:Deployment"] ?? _config["AzureOpenAI:Model"];
            if (string.IsNullOrWhiteSpace(deployment))
                return defaultResult;

            var prompt = $@"You are a system that transforms internal knowledge transfer documents into:
1) A concise executive summary (max 120 words)
2) A structured video script divided into clear SCENES (each <= 70 words)
3) A short quiz: 3 multiple-choice questions with 4 options and an integer correctIndex.

Return JSON with keys: summary, scenes (array of strings), quiz (array of objects: question, options[], correctIndex).

Document Content:
---
{documentText}
---";

            var chat = await _openAI.GetChatCompletionsAsync(deployment, new ChatCompletionsOptions
            {
                Messages = { new ChatMessage(ChatRole.System, prompt) },
                Temperature = 0.4f,
                MaxTokens = 1200
            });

            var content = chat.Value.Choices.First().Message.Content;
            var json = JsonDocument.Parse(content);
            var root = json.RootElement;

            var summary = root.GetProperty("summary").GetString() ?? defaultResult.Summary;
            var scenes = root.GetProperty("scenes").EnumerateArray().Select(e => e.GetString() ?? string.Empty).Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
            var quiz = new List<object>();
            foreach (var q in root.GetProperty("quiz").EnumerateArray())
            {
                quiz.Add(new
                {
                    question = q.GetProperty("question").GetString(),
                    options = q.GetProperty("options").EnumerateArray().Select(o => o.GetString()).ToArray(),
                    correctIndex = q.GetProperty("correctIndex").GetInt32()
                });
            }
            return (summary, scenes, quiz);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OpenAI generation failed, using fallback content");
            return defaultResult;
        }
    }

    private async Task<List<string>> GenerateAudioAsync(List<string> scenes)
    {
        var results = new List<string>();
        var speechKey = _config["Speech:ApiKey"];
        var speechRegion = _config["Speech:Region"];
        if (string.IsNullOrWhiteSpace(speechKey) || string.IsNullOrWhiteSpace(speechRegion))
        {
            return scenes.Select((s, i) => $"(no-audio-scene-{i+1}.txt)").ToList();
        }
        var container = _blobServiceClient.GetBlobContainerClient("generated-audio");
        await container.CreateIfNotExistsAsync(PublicAccessType.None);

        var config = SpeechConfig.FromSubscription(speechKey, speechRegion);
        config.SpeechSynthesisVoiceName = _config["Speech:Voice"] ?? "en-US-JennyNeural";

        for (int i = 0; i < scenes.Count; i++)
        {
            var scene = scenes[i];
            var fileName = $"{Guid.NewGuid():N}-scene{i+1}.mp3";
            try
            {
                using var audioOut = AudioConfig.FromStreamOutput(new PullAudioOutputStreamCallbackWrapper());
                using var synthesizer = new SpeechSynthesizer(config, audioOut);
                var result = await synthesizer.SpeakTextAsync(scene);
                if (result.Reason == ResultReason.SynthesizingAudioCompleted)
                {
                    // Convert to stream and upload
                    var audioData = result.AudioData;
                    using var ms = new MemoryStream(audioData);
                    var blob = container.GetBlobClient(fileName);
                    await blob.UploadAsync(ms, new BlobHttpHeaders{ ContentType = "audio/mpeg" });
                    results.Add(fileName);
                }
                else
                {
                    _logger.LogWarning("Audio synthesis failed for scene {Index}: {Reason}", i+1, result.Reason);
                    results.Add($"(tts-failed-scene-{i+1}.txt)");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error synthesizing scene {Index}", i+1);
                results.Add($"(tts-error-scene-{i+1}.txt)");
            }
        }
        return results;
    }

    private async Task UploadJsonAsync(string containerName, string blobName, object payload)
    {
        var container = _blobServiceClient.GetBlobContainerClient(containerName);
        await container.CreateIfNotExistsAsync(PublicAccessType.None);
        var blob = container.GetBlobClient(blobName);
        using var ms = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(payload, new JsonSerializerOptions{ WriteIndented = true }));
        await blob.UploadAsync(ms, overwrite: true);
    }
}

// Simple wrapper to satisfy required AudioConfig; this could be replaced with a direct file output approach.
internal class PullAudioOutputStreamCallbackWrapper : PullAudioOutputStreamCallback
{
    private readonly MemoryStream _buffer = new();
    public override int Read(byte[] dataBuffer, uint size)
    {
        // For simplicity, not implementing streaming; TTS result provides AudioData we use instead.
        return 0;
    }
}
