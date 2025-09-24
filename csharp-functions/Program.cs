using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Azure;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((ctx, services) =>
    {
        // Minimal services: BlobServiceClient via connection string
        services.AddAzureClients(builder =>
        {
            var config = ctx.Configuration;
            var storageConn = config["AzureWebJobsStorage"] ?? config["Storage:ConnectionString"];
            if (!string.IsNullOrWhiteSpace(storageConn))
            {
                builder.AddBlobServiceClient(storageConn);
            }
        });
    })
    .Build();

await host.RunAsync();
