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

try
{
    var host = new HostBuilder()
        .ConfigureFunctionsWorkerDefaults()
        .ConfigureServices((ctx, services) =>
        {
            services.AddLogging();

            // Defer expensive setup until after service provider built for logging
            services.PostConfigure<Microsoft.Extensions.Logging.LoggerFilterOptions>(opts => { });

            services.AddSingleton(provider =>
            {
                var logger = provider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
                var config = provider.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();
                try
                {
                    var conn = ResolveStorageConnection(config, logger);
                    if (!string.IsNullOrWhiteSpace(conn))
                    {
                        logger.LogInformation("[Startup] Initializing BlobServiceClient...");
                        return new BlobServiceClient(conn);
                    }
                    logger.LogWarning("[Startup] No storage connection string available. Returning null BlobServiceClient placeholder.");
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "[Startup] Exception constructing BlobServiceClient. Functions may not bind to blob triggers.");
                }
                return null!; // Will cause DI failure only if actually injected; blob trigger function will log its own error if missing.
            });
        })
        .Build();

    await host.RunAsync();
}
catch (Exception fatal)
{
    // Last resort logging - we do not swallow silently. Azure will surface this but we add detail.
    Console.Error.WriteLine("[Fatal-Startup] Unhandled exception bringing up Functions host: " + fatal);
    Console.Error.WriteLine(fatal.StackTrace);
    throw; // Re-throw so platform knows startup failed.
}
