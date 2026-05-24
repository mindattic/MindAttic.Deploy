using System.Diagnostics;
using Spectre.Console;

namespace MindAttic.Deploy.Cli.Services;

/// <summary>Shells into the canonical node `src/deploy.js` pipeline.</summary>
public sealed class DeployRunner
{
    private readonly string _repoRoot;
    public DeployRunner(string repoRoot) => _repoRoot = repoRoot;

    public int RunCatalog(string? onlySlug, bool skipBuild)
    {
        var args = new List<string> { "src/deploy.js" };
        if (!string.IsNullOrWhiteSpace(onlySlug)) { args.Add("--only"); args.Add(onlySlug); }
        if (skipBuild) args.Add("--skip-build");
        return RunNode(args);
    }

    public int RunSite(string? slug, bool all)
    {
        var args = new List<string> { "src/deploy.js" };
        if (all) args.Add("--sites");
        else if (!string.IsNullOrWhiteSpace(slug)) { args.Add("--site"); args.Add(slug); }
        else throw new ArgumentException("RunSite requires either --slug or --all.");
        return RunNode(args);
    }

    public int RunApp(string? slug, bool all, bool dryRun)
    {
        var args = new List<string> { "src/deploy.js" };
        if (all) args.Add("--apps");
        else if (!string.IsNullOrWhiteSpace(slug)) { args.Add("--app"); args.Add(slug); }
        else throw new ArgumentException("RunApp requires either --slug or --all.");
        if (dryRun) args.Add("--dry-run");
        return RunNode(args);
    }

    private int RunNode(IList<string> args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            WorkingDirectory = _repoRoot,
            UseShellExecute = false,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        AnsiConsole.MarkupLine($"[grey]> node {string.Join(' ', args)}[/]");
        AnsiConsole.MarkupLine($"[grey]  cwd: {_repoRoot}[/]");

        try
        {
            using var p = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start node.");
            p.WaitForExit();
            return p.ExitCode;
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 2)
        {
            AnsiConsole.MarkupLine("[red]Could not find `node` on PATH. Install Node.js (nodejs.org) and re-run.[/]");
            return 127;
        }
    }
}
