using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Azure.Storage.Blobs;

static string? ResolveStorageConnection(Microsoft.Extensions.Configuration.IConfiguration config, ILogger logger)
{
    var orderedKeys = new[]
    {
        "BLOB_CONNECTION_STRING",
        "AZURE_STORAGE_CONNECTION_STRING",
        "blob_connection_string",
        "AzureWebJobsStorage"
    };
    foreach (var k in orderedKeys)
    {
        var v = config[k];
        if (!string.IsNullOrWhiteSpace(v))
        {
            logger.LogInformation("[Startup] Using storage connection from {Key}", k);
            return v;
        }
    }
    logger.LogWarning("[Startup] No storage connection string found in expected environment variables.");
    return null;
}

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((ctx, services) =>
    {
        services.AddLogging();
        var provider = services.BuildServiceProvider();
        var loggerFactory = provider.GetRequiredService<ILoggerFactory>();
        var logger = loggerFactory.CreateLogger("Startup");
        var config = ctx.Configuration;

        var conn = ResolveStorageConnection(config, logger);
        if (!string.IsNullOrWhiteSpace(conn))
        {
            services.AddSingleton(new BlobServiceClient(conn));
        }
        else
        {
            logger.LogError("[Startup] BlobServiceClient NOT registered (missing storage connection string). Blob trigger will fail.");
        }
    })
    .Build();

await host.RunAsync();
