using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Azure;
using Azure.AI.OpenAI;
using Azure;
using Serilog;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((ctx, services) =>
    {
        // Configuration
        var config = ctx.Configuration;

        // Serilog
        Log.Logger = new LoggerConfiguration()
            .WriteTo.Console()
            .CreateLogger();
        services.AddLogging(lb => lb.AddSerilog());

        // Azure OpenAI
        var openAiEndpoint = config["AzureOpenAI:Endpoint"];
        var openAiKey = config["AzureOpenAI:ApiKey"];
        if (!string.IsNullOrWhiteSpace(openAiEndpoint) && !string.IsNullOrWhiteSpace(openAiKey))
        {
            services.AddSingleton(new OpenAIClient(new Uri(openAiEndpoint), new AzureKeyCredential(openAiKey)));
        }

        // Azure Clients (Blob)
        services.AddAzureClients(builder =>
        {
            var storageConn = config["AzureWebJobsStorage"] ?? config["Storage:ConnectionString"];
            if (!string.IsNullOrWhiteSpace(storageConn))
            {
                builder.AddBlobServiceClient(storageConn);
            }
        });
    })
    .Build();

await host.RunAsync();
