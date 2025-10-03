using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.Extensions.Logging;

namespace KTStudio.Functions;

internal sealed class DocumentContentExtractor
{
	private const int MaxSegmentCharacters = 3500;

	public DocumentExtractionResult Extract(string documentName, string rawContent, string? contentType, ILogger logger)
	{
		if (rawContent == null)
		{
			throw new DocumentExtractionException("Document payload was null – cannot continue.");
		}

		if (AppearsBinary(rawContent))
		{
			throw new DocumentExtractionException($"Document '{documentName}' is not a supported text format. ContentType='{contentType ?? "(unknown)"}'.");
		}

		var normalized = Normalize(rawContent);
		if (string.IsNullOrWhiteSpace(normalized))
		{
			throw new DocumentExtractionException($"Document '{documentName}' appears to be empty after normalization.");
		}

		var segments = Segment(normalized);
		var wordCount = CountWords(normalized);
		var estimatedTokens = (int)Math.Ceiling(wordCount * 1.3);

		logger?.LogInformation(
			"[DocumentContentExtractor] Extracted document {Document} -> Words={Words} Segments={Segments} EstimatedTokens={Tokens} ContentType={ContentType}",
			documentName,
			wordCount,
			segments.Count,
			estimatedTokens,
			contentType ?? "(unknown)");

		return new DocumentExtractionResult(documentName, normalized, segments, wordCount, estimatedTokens, contentType);
	}

	private static bool AppearsBinary(string content)
	{
		if (string.IsNullOrEmpty(content))
		{
			return true;
		}

		var sampleLength = Math.Min(2048, content.Length);
		var controlCount = 0;
		for (var i = 0; i < sampleLength; i++)
		{
			var ch = content[i];
			if (char.IsControl(ch) && ch != '\r' && ch != '\n' && ch != '\t')
			{
				controlCount++;
			}
		}

		return sampleLength > 0 && controlCount > sampleLength * 0.15;
	}

	private static string Normalize(string input)
	{
		var builder = new StringBuilder(input.Length);
		using var reader = new StringReader(input);
		string? line;
		var consecutiveBlank = 0;
		while ((line = reader.ReadLine()) != null)
		{
			var trimmedLine = line.TrimEnd();
			if (string.IsNullOrWhiteSpace(trimmedLine))
			{
				consecutiveBlank++;
				if (consecutiveBlank > 1)
				{
					continue;
				}
				builder.AppendLine();
			}
			else
			{
				consecutiveBlank = 0;
				builder.AppendLine(trimmedLine);
			}
		}

		return builder.ToString().Trim();
	}

	private static IReadOnlyList<string> Segment(string text)
	{
		var segments = new List<string>();
		var current = new StringBuilder();

		using var reader = new StringReader(text);
		string? line;
		while ((line = reader.ReadLine()) != null)
		{
			if (current.Length + line.Length + 1 > MaxSegmentCharacters && current.Length > 0)
			{
				segments.Add(current.ToString().Trim());
				current.Clear();
			}

			current.AppendLine(line);
		}

		if (current.Length > 0)
		{
			segments.Add(current.ToString().Trim());
		}

		var normalized = new List<string>();
		foreach (var segment in segments)
		{
			if (segment.Length <= MaxSegmentCharacters)
			{
				if (!string.IsNullOrWhiteSpace(segment))
				{
					normalized.Add(segment);
				}
				continue;
			}

			var offset = 0;
			while (offset < segment.Length)
			{
				var length = Math.Min(MaxSegmentCharacters, segment.Length - offset);
				var slice = segment.Substring(offset, length).Trim();
				if (!string.IsNullOrWhiteSpace(slice))
				{
					normalized.Add(slice);
				}
				offset += length;
			}
		}

		return normalized.Count > 0 ? normalized : new List<string> { text.Trim() };
	}

	private static int CountWords(string text)
	{
		if (string.IsNullOrWhiteSpace(text))
		{
			return 0;
		}

		return text
			.Split(new[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries)
			.Length;
	}
}

internal sealed record DocumentExtractionResult(
	string DocumentName,
	string FullText,
	IReadOnlyList<string> Segments,
	int WordCount,
	int EstimatedTokenCount,
	string? ContentType);

internal sealed class DocumentExtractionException : Exception
{
	public DocumentExtractionException(string message) : base(message)
	{
	}

	public DocumentExtractionException(string message, Exception innerException) : base(message, innerException)
	{
	}
}
