using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
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
    private static readonly Regex SentenceSplitRegex = new(@"(?<=[\.\?!])\s+", RegexOptions.Compiled);
    private static readonly Regex MultiWhitespaceRegex = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex BulletPrefixRegex = new(@"^\s*([\-\*•●]\s+)", RegexOptions.Compiled);
    private static readonly Regex NonWordRegex = new(@"[^a-z0-9]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly string[] SubjectSeparators =
    {
        " consists of ",
        " focuses on ",
        " focus on ",
        " is about ",
        " is defined as ",
        " is defined by ",
        " is described as ",
        " is described by ",
        " is ",
        " are ",
        " includes ",
        " contains ",
        " covers ",
        " requires ",
        " ensures ",
        " enables ",
        " provides ",
        " delivers ",
        " supports ",
        " means ",
        " describes ",
        " details ",
        " explains ",
        " outlines ",
        " specifies ",
        " highlights ",
        " demonstrates ",
        " shows ",
        " allows ",
        " helps ",
        " uses "
    };

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

        DocumentExtractionResult? extraction = null;
        try
        {
            var extractor = new DocumentContentExtractor();
            extraction = extractor.Extract(docName, documentText, null, _logger);
        }
        catch (DocumentExtractionException dex)
        {
            _logger.LogWarning(dex, "[ProcessKTDocument] Unable to normalize document {Document}; proceeding with raw text.", docName);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[ProcessKTDocument] Unexpected error while preparing document {Document}; proceeding with raw text.", docName);
        }

        var normalizedText = extraction?.FullText ?? documentText;
        var promptSegments = extraction?.Segments;

        GenerationResult? generated = null;

        if (!string.IsNullOrWhiteSpace(endpoint) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(deployment))
        {
            try
            {
                generated = await TryGenerateWithAzureOpenAi(endpoint, apiKey, deployment, normalizedText, promptSegments, docName);
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
                (summary, scenes, quiz) = BuildFallbackContent(normalizedText);
            }

            quiz = EnsureQuizQuality(quiz, scenes, extraction, normalizedText);

        await PopulateSceneImagesAsync(docName, scenes);

        return (summary, scenes, quiz);
    }

    private (string Summary, List<SceneData> Scenes, List<QuizQuestion> Quiz) BuildFallbackContent(string documentText)
    {
        var paragraphs = documentText.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Trim())
            .Where(p => p.Length > 25)
            .Distinct()
            .Take(8)
            .ToList();

        if (paragraphs.Count < 5 && paragraphs.Count > 0)
        {
            var expanded = new List<string>(paragraphs);
            foreach (var paragraph in paragraphs)
            {
                if (expanded.Count >= 5)
                {
                    break;
                }

                if (paragraph.Length > 120)
                {
                    var midpoint = paragraph.Length / 2;
                    var splitIndex = paragraph.IndexOf('.', midpoint);
                    if (splitIndex <= 0)
                    {
                        splitIndex = paragraph.IndexOf(',', midpoint);
                    }
                    if (splitIndex > 60 && splitIndex < paragraph.Length - 40)
                    {
                        var first = paragraph[..(splitIndex + 1)].Trim();
                        var second = paragraph[(splitIndex + 1)..].Trim();
                        if (!string.IsNullOrWhiteSpace(first)) expanded.Add(first);
                        if (expanded.Count >= 5) break;
                        if (!string.IsNullOrWhiteSpace(second)) expanded.Add(second);
                    }
                }
            }

            paragraphs = expanded.Distinct().Take(8).ToList();
        }

        if (paragraphs.Count == 0)
        {
            paragraphs.Add("The uploaded document did not contain enough readable text to generate a storyboard. Add richer descriptions to unlock full AI visuals.");
        }

        var summarySource = paragraphs.First();
        var summary = summarySource.Length > 160 ? summarySource[..160] + "..." : summarySource;

        if (paragraphs.Count < 5)
        {
            while (paragraphs.Count < 5)
            {
                paragraphs.Add(summarySource);
            }
        }

        var scenes = paragraphs.Take(8).Select((text, idx) => SceneData.FromFallback(text, idx)).ToList();

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

    private List<QuizQuestion> EnsureQuizQuality(List<QuizQuestion> quiz, List<SceneData> scenes, DocumentExtractionResult? extraction, string normalizedText)
    {
        var facts = ExtractFactCandidates(extraction, scenes, normalizedText);
        if (facts.Count == 0)
        {
            return quiz.Take(4).ToList();
        }

        var grounded = new List<QuizQuestion>();
        var usedQuestionTexts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < quiz.Count; i++)
        {
            var normalized = NormalizeGeneratedQuestion(quiz[i], facts, normalizedText, grounded.Count + 1, usedQuestionTexts);
            if (normalized != null)
            {
                grounded.Add(normalized);
            }
            if (grounded.Count >= 4)
            {
                break;
            }
        }

        if (grounded.Count < 4)
        {
            var replacements = BuildQuizGroundedInDocument(facts, grounded.Count, usedQuestionTexts);
            foreach (var question in replacements)
            {
                grounded.Add(question);
                if (grounded.Count >= 4)
                {
                    break;
                }
            }
        }

        if (grounded.Count < 4 && facts.Count > 0)
        {
            while (grounded.Count < 4)
            {
                var fact = facts[(grounded.Count) % facts.Count];
                var filler = CreateSimpleFactQuestion(fact, grounded.Count + 1, usedQuestionTexts);
                if (filler == null)
                {
                    break;
                }
                grounded.Add(filler);
            }
        }

        if (grounded.Count < 4)
        {
            foreach (var item in quiz)
            {
                if (grounded.Count >= 4)
                {
                    break;
                }

                if (grounded.Any(g => string.Equals(g.Text, item.Text, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                var fallbackOptions = PrepareOptions(item.Options ?? new List<string>());
                if (fallbackOptions.Count < 4)
                {
                    continue;
                }

                var correctedIndex = Math.Clamp(item.CorrectIndex, 0, fallbackOptions.Count - 1);
                var explanation = string.IsNullOrWhiteSpace(item.Explanation)
                    ? "Reference the uploaded document for the correct detail."
                    : item.Explanation;

                var id = item.Id ?? $"q{grounded.Count + 1}";
                grounded.Add(new QuizQuestion(id, item.Text, fallbackOptions, correctedIndex, explanation));
                usedQuestionTexts.Add(item.Text);
            }
        }

        if (grounded.Count == 0 && quiz.Count > 0)
        {
            return quiz.Take(4).ToList();
        }

        return grounded.Take(4).ToList();
    }

    private QuizQuestion? CreateSimpleFactQuestion(string fact, int nextIndex, HashSet<string> usedQuestionTexts)
    {
        if (string.IsNullOrWhiteSpace(fact))
        {
            return null;
        }

        var questionText = "Which statement is supported by the document?";
        if (!usedQuestionTexts.Add(questionText))
        {
            questionText = $"{questionText} #{nextIndex}";
        }

        var distractors = GenerateDistractorsFromFact(fact, 3);
        if (distractors.Count < 3)
        {
            return null;
        }

        var options = new List<string> { TruncateOption(fact) };
        options.AddRange(distractors.Take(3));
        if (options.Count < 4)
        {
            return null;
        }

        var (shuffled, correctIndex) = RotateOptions(options);
        var explanation = $"Reference: {fact}";
        return new QuizQuestion($"q{nextIndex}", questionText, shuffled, correctIndex, explanation);
    }

    private QuizQuestion? NormalizeGeneratedQuestion(QuizQuestion source, IReadOnlyList<string> facts, string normalizedText, int nextIndex, HashSet<string> usedQuestionTexts)
    {
        if (source.Options == null || source.Options.Count == 0)
        {
            return null;
        }

        var options = PrepareOptions(source.Options);
        if (options.Count < 4)
        {
            return null;
        }

        var correctIndex = Math.Clamp(source.CorrectIndex, 0, options.Count - 1);
        var correctText = options[correctIndex];

        var evidence = FindSupportingFact(correctText, facts, normalizedText);
        if (evidence == null)
        {
            return null;
        }

        var questionText = string.IsNullOrWhiteSpace(source.Text) ? "Which statement is supported by the document?" : source.Text.Trim();
        if (!usedQuestionTexts.Add(questionText))
        {
            questionText = $"{questionText} ({nextIndex})";
            usedQuestionTexts.Add(questionText);
        }

        var explanation = string.IsNullOrWhiteSpace(source.Explanation)
            ? $"Evidence from the document: {evidence}"
            : AppendEvidence(source.Explanation, evidence);

        var id = string.IsNullOrWhiteSpace(source.Id) ? $"q{nextIndex}" : source.Id;

        return new QuizQuestion(id, questionText, options, correctIndex, explanation);
    }

    private static List<string> PrepareOptions(List<string> options)
    {
        var unique = options
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .Select(o => o.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(4)
            .ToList();

        var fillerIndex = 0;
        while (unique.Count < 4)
        {
            fillerIndex++;
            unique.Add(fillerIndex switch
            {
                1 => "Not stated in the document",
                2 => "Contradicted by the text",
                3 => "Irrelevant detail",
                _ => $"Alternative option {fillerIndex}"
            });
        }

        return unique;
    }

    private static string AppendEvidence(string explanation, string evidence)
    {
        var trimmed = explanation.Trim();
        if (trimmed.Contains(evidence, StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        if (!trimmed.EndsWith('.'))
        {
            trimmed += '.';
        }

        return $"{trimmed} Evidence: {evidence}";
    }

    private List<QuizQuestion> BuildQuizGroundedInDocument(IReadOnlyList<string> facts, int existingCount, HashSet<string> usedQuestionTexts)
    {
        var questions = new List<QuizQuestion>();
        if (facts.Count == 0)
        {
            return questions;
        }

        var index = 0;
        var attempts = 0;
        while (questions.Count < 4 && attempts < facts.Count * 3)
        {
            var fact = facts[index % facts.Count];
            index++;
            var parts = ComposeQuestionParts(fact, facts);
            if (parts == null)
            {
                attempts++;
                continue;
            }

            var (questionText, correct, distractors) = parts.Value;
            if (!usedQuestionTexts.Add(questionText))
            {
                questionText = $"{questionText} #{existingCount + questions.Count + 1}";
            }

            var options = new List<string> { correct };
            options.AddRange(distractors.Take(3));

            if (options.Count < 4)
            {
                continue;
            }

            var (shuffledOptions, correctIndex) = RotateOptions(options);
            var explanation = $"Reference: {fact}";
            var id = $"q{existingCount + questions.Count + 1}";

            questions.Add(new QuizQuestion(id, questionText, shuffledOptions, correctIndex, explanation));

            attempts++;
        }

        return questions;
    }

    private static (List<string> Options, int CorrectIndex) RotateOptions(List<string> options)
    {
        if (options.Count < 4)
        {
            return (options, 0);
        }

        var rotated = new List<string>(options);
        var correctIndex = 0;

        if (options.Count == 4)
        {
            var rotation = options[0].Length % 4;
            if (rotation > 0)
            {
                rotated = options.Skip(rotation).Concat(options.Take(rotation)).ToList();
                correctIndex = (4 - rotation) % 4;
            }
        }

        return (rotated, correctIndex);
    }

    private static (string Question, string Correct, List<string> Distractors)? ComposeQuestionParts(string fact, IReadOnlyList<string> allFacts)
    {
        if (string.IsNullOrWhiteSpace(fact))
        {
            return null;
        }

        var subject = string.Empty;
        var remainder = fact;
        foreach (var separator in SubjectSeparators)
        {
            var index = fact.IndexOf(separator, StringComparison.OrdinalIgnoreCase);
            if (index > 10)
            {
                subject = fact[..index].Trim();
                remainder = fact[(index + separator.Length)..].Trim();
                break;
            }
        }

        if (string.IsNullOrWhiteSpace(subject))
        {
            subject = string.Join(' ', fact.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6));
            remainder = fact;
        }

        if (string.IsNullOrWhiteSpace(remainder) || remainder.Length < 15)
        {
            return null;
        }

        var questionText = $"According to the document, what about {subject}?";
        var correct = TruncateOption(remainder);

        var distractors = new List<string>();
        foreach (var alt in allFacts)
        {
            if (string.Equals(alt, fact, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var option = TruncateOption(alt);
            if (!distractors.Any(existing => string.Equals(existing, option, StringComparison.OrdinalIgnoreCase)))
            {
                distractors.Add(option);
            }
            if (distractors.Count >= 3)
            {
                break;
            }
        }

        if (distractors.Count < 3)
        {
            distractors.AddRange(GenerateDistractorsFromFact(fact, 3 - distractors.Count));
        }

        if (distractors.Count < 3)
        {
            return null;
        }

        return (questionText, correct, distractors);
    }

    private static List<string> GenerateDistractorsFromFact(string fact, int needed)
    {
        var distractors = new List<string>();
        if (needed <= 0)
        {
            return distractors;
        }

        var numberMatches = Regex.Matches(fact, @"\d+");
        if (numberMatches.Count > 0)
        {
            foreach (Match match in numberMatches)
            {
                if (!int.TryParse(match.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
                {
                    continue;
                }
                var mutated = fact.Replace(match.Value, (value + 1).ToString(CultureInfo.InvariantCulture));
                distractors.Add(TruncateOption(mutated));
                if (distractors.Count >= needed)
                {
                    return distractors;
                }
            }
        }

        var replacements = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["must"] = "should consider",
            ["required"] = "optional",
            ["enables"] = "prevents",
            ["ensures"] = "cannot guarantee",
            ["increase"] = "reduce",
            ["improve"] = "weaken",
            ["supports"] = "ignores",
            ["recommended"] = "discouraged"
        };

        foreach (var kvp in replacements)
        {
            if (fact.Contains(kvp.Key, StringComparison.OrdinalIgnoreCase))
            {
                var mutated = Regex.Replace(fact, kvp.Key, kvp.Value, RegexOptions.IgnoreCase);
                distractors.Add(TruncateOption(mutated));
                if (distractors.Count >= needed)
                {
                    return distractors;
                }
            }
        }

        while (distractors.Count < needed)
        {
            distractors.Add("Statement not aligned with the document." + (distractors.Count + 1));
        }

        return distractors;
    }

    private static string TruncateOption(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return text;
        }

        var cleaned = MultiWhitespaceRegex.Replace(text.Trim(), " ");
        return cleaned.Length <= 120 ? cleaned : cleaned[..120].TrimEnd() + "...";
    }

    private string? FindSupportingFact(string target, IReadOnlyList<string> facts, string normalizedText)
    {
        if (string.IsNullOrWhiteSpace(target))
        {
            return null;
        }

        var normalizedTarget = NormalizeForComparison(target);
        if (string.IsNullOrWhiteSpace(normalizedTarget))
        {
            return null;
        }

        foreach (var fact in facts)
        {
            var normalizedFact = NormalizeForComparison(fact);
            var overlap = ComputeOverlap(normalizedTarget, normalizedFact);
            if (overlap >= 0.4)
            {
                return fact;
            }
        }

        if (!string.IsNullOrWhiteSpace(normalizedText) && normalizedText.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return TruncateOption(target);
        }

        return null;
    }

    private static double ComputeOverlap(string a, string b)
    {
        var tokensA = Tokenize(a);
        var tokensB = Tokenize(b);
        if (tokensA.Count == 0 || tokensB.Count == 0)
        {
            return 0;
        }

        var matchCount = tokensA.Count(token => tokensB.Contains(token));
        return (double)matchCount / tokensA.Count;
    }

    private static List<string> Tokenize(string text)
    {
        return NonWordRegex.Split(text.ToLowerInvariant())
            .Where(token => token.Length > 3)
            .Distinct()
            .ToList();
    }

    private static string NormalizeForComparison(string text)
    {
        var collapsed = MultiWhitespaceRegex.Replace(text.ToLowerInvariant(), " ").Trim();
        return NonWordRegex.Replace(collapsed, " ").Trim();
    }

    private List<string> ExtractFactCandidates(DocumentExtractionResult? extraction, List<SceneData> scenes, string normalizedText)
    {
        var candidates = new List<string>();

        if (extraction?.Segments != null)
        {
            foreach (var segment in extraction.Segments)
            {
                candidates.AddRange(SplitIntoSentences(segment));
            }
        }

        if (!string.IsNullOrWhiteSpace(normalizedText))
        {
            candidates.AddRange(SplitIntoSentences(normalizedText));
        }

        foreach (var scene in scenes)
        {
            if (!string.IsNullOrWhiteSpace(scene.Narration))
            {
                candidates.Add(scene.Narration);
            }
        }

        var facts = new List<string>();
        foreach (var candidate in candidates)
        {
            var cleaned = BulletPrefixRegex.Replace(candidate.Trim(), string.Empty);
            cleaned = MultiWhitespaceRegex.Replace(cleaned, " ");
            if (cleaned.Length < 35 || cleaned.Length > 260)
            {
                continue;
            }

            if (cleaned.Split(' ').Length < 6)
            {
                continue;
            }

            if (!facts.Any(existing => string.Equals(existing, cleaned, StringComparison.OrdinalIgnoreCase)))
            {
                facts.Add(cleaned);
            }

            if (facts.Count >= 120)
            {
                break;
            }
        }

        return facts;
    }

    private IEnumerable<string> SplitIntoSentences(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return Enumerable.Empty<string>();
        }

        return SentenceSplitRegex.Split(text)
            .Select(sentence => sentence.Trim())
            .Where(sentence => !string.IsNullOrWhiteSpace(sentence));
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

    private async Task<GenerationResult?> TryGenerateWithAzureOpenAi(
        string endpoint,
        string apiKey,
        string deployment,
        string documentText,
        IReadOnlyList<string>? segments,
        string documentName)
    {
        var baseUri = endpoint.EndsWith('/') ? endpoint : endpoint + "/";
        var requestUri = new Uri(new Uri(baseUri), $"openai/deployments/{deployment}/chat/completions?api-version=2024-08-01-preview");

        var excerpts = new List<string>();
        if (segments != null)
        {
            foreach (var segment in segments.Where(s => !string.IsNullOrWhiteSpace(s)).Take(6))
            {
                var trimmed = segment.Trim();
                if (string.IsNullOrWhiteSpace(trimmed)) continue;
                excerpts.Add(Truncate(trimmed, 700));
            }
        }

        if (excerpts.Count == 0)
        {
            excerpts.Add(Truncate(documentText, 900));
        }

        var excerptBlock = string.Join("\n\n", excerpts.Select((content, idx) => $"Excerpt {idx + 1}:\n{content}"));
        var limitedContext = Truncate(documentText, 6000);

        const string systemPrompt = "You are an instructional designer who turns enterprise knowledge-transfer documents into concise storyboards and rigorous multiple-choice quizzes. Base every output strictly on the supplied source excerpts. Avoid speculation, generic trivia, or outside knowledge.";

        const string rubricPrompt = "Quiz requirements:\n- Write exactly four multiple-choice questions.\n- Each question must focus on a single fact, process step, or definition taken directly from the document.\n- Use wording from the context verbatim or as a faithful paraphrase.\n- Provide four answer options: one correct answer, three plausible distractors that conflict with the source material.\n- Include a short explanation referencing the specific excerpt that proves the answer.";

        var userPrompt = $@"Document title: {documentName}

Use these curated excerpts to understand the content:

{excerptBlock}

Full context (trimmed to 6k characters):
{limitedContext}

Deliverables:
1. Provide a summary (≤220 characters) that captures the main purpose of the document.
2. Produce 5-8 storyboard scenes covering distinct concepts. Each scene needs a short title and narration grounded in the context.
3. Produce exactly 4 quiz questions that meet the requirements above.

Return valid JSON matching the schema provided in the response_format. Do not include any extra commentary.";

        var payload = new
        {
            temperature = 0.2,
            top_p = 0.85,
            max_tokens = 1400,
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
                new { role = "system", content = systemPrompt },
                new { role = "system", content = rubricPrompt },
                new { role = "user", content = userPrompt }
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
                minItems = 5,
                maxItems = 8,
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
