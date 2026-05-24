using System.Text.Json;
using MindAttic.Deploy.Cli.Models;

namespace MindAttic.Deploy.Cli.Services;

/// <summary>
/// Resolves the MindAttic.Deploy repo root (where projects.json + src/deploy.js live)
/// and loads the canonical registry.
/// </summary>
public sealed class ProjectRoster
{
    public string RepoRoot { get; }
    public DeployConfig Config { get; }

    private ProjectRoster(string repoRoot, DeployConfig config)
    {
        RepoRoot = repoRoot;
        Config = config;
    }

    public static ProjectRoster Load()
    {
        var repoRoot = ResolveRepoRoot();
        var jsonPath = Path.Combine(repoRoot, "projects.json");
        if (!File.Exists(jsonPath))
            throw new FileNotFoundException($"projects.json not found at {jsonPath}");

        var options = new JsonSerializerOptions { AllowTrailingCommas = true, ReadCommentHandling = JsonCommentHandling.Skip };
        var json = File.ReadAllText(jsonPath);
        var config = JsonSerializer.Deserialize<DeployConfig>(json, options)
            ?? throw new InvalidOperationException("projects.json deserialized to null.");

        return new ProjectRoster(repoRoot, config);
    }

    /// <summary>
    /// MINDATTIC_DEPLOY_ROOT env var wins. Otherwise walk up from the exe directory
    /// looking for projects.json + src/deploy.js.
    /// </summary>
    private static string ResolveRepoRoot()
    {
        var env = Environment.GetEnvironmentVariable("MINDATTIC_DEPLOY_ROOT");
        if (!string.IsNullOrWhiteSpace(env) && Directory.Exists(env))
            return Path.GetFullPath(env);

        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "projects.json")) &&
                File.Exists(Path.Combine(dir.FullName, "src", "deploy.js")))
            {
                return dir.FullName;
            }
            dir = dir.Parent;
        }
        throw new InvalidOperationException(
            "Could not locate the MindAttic.Deploy repo root. " +
            "Set MINDATTIC_DEPLOY_ROOT or run from inside the repo.");
    }
}
