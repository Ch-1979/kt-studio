using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Azure.Storage.Blobs;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((ctx, services) =>
    {
        var config = ctx.Configuration;
        var storageConn = config["AzureWebJobsStorage"] ?? config["Storage:ConnectionString"];
        if (!string.IsNullOrWhiteSpace(storageConn))
        {
            services.AddSingleton(new BlobServiceClient(storageConn));
        }
    })
    .Build();

await host.RunAsync();
