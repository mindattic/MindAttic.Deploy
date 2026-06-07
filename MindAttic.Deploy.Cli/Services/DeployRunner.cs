using System.Diagnostics;
using Spectre.Console;

namespace MindAttic.Deploy.Cli.Services;

/// <summary>Shells into the canonical node `src/deploy.js` pipeline.</summary>
public sealed class DeployRunner
{
    private readonly string _repoRoot;
    public DeployRunner(string repoRoot) => _repoRoot = repoRoot;

    public int RunCatalog(
        IEnumerable<string>? onlySlugs, bool skipBuild, bool dryRun,
        bool fromGithub = false, string? gitRef = null,
        string? siblingsRoot = null, string? themesRoot = null, string? components = null)
    {
        var args = new List<string> { "src/deploy.js" };
        if (onlySlugs != null)
        {
            foreach (var slug in onlySlugs)
            {
                if (string.IsNullOrWhiteSpace(slug)) continue;
                args.Add("--only");
                args.Add(slug);
            }
        }
        if (skipBuild) args.Add("--skip-build");
        if (dryRun) args.Add("--dry-run");
        if (fromGithub) args.Add("--from-github");
        if (!string.IsNullOrWhiteSpace(gitRef))      { args.Add("--ref");            args.Add(gitRef); }
        if (!string.IsNullOrWhiteSpace(siblingsRoot)) { args.Add("--siblings-root"); args.Add(siblingsRoot); }
        if (!string.IsNullOrWhiteSpace(themesRoot))   { args.Add("--themes-root");   args.Add(themesRoot); }
        if (!string.IsNullOrWhiteSpace(components))   { args.Add("--components");    args.Add(components); }
        return RunNode(args);
    }

    public int RunSite(string? slug, bool all, bool dryRun)
    {
        var args = new List<string> { "src/deploy.js" };
        if (all) args.Add("--sites");
        else if (!string.IsNullOrWhiteSpace(slug)) { args.Add("--site"); args.Add(slug); }
        else throw new ArgumentException("RunSite requires either --slug or --all.");
        if (dryRun) args.Add("--dry-run");
        return RunNode(args);
    }

    public int RunApp(string? slug, bool all, bool dryRun, bool includeDisabled)
    {
        var args = new List<string> { "src/deploy.js" };
        if (all) args.Add("--apps");
        else if (!string.IsNullOrWhiteSpace(slug)) { args.Add("--app"); args.Add(slug); }
        else throw new ArgumentException("RunApp requires either --slug or --all.");
        if (dryRun) args.Add("--dry-run");
        if (includeDisabled) args.Add("--include-disabled");
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
        // Match package.json's `deploy`/`all` scripts: trust the OS certificate
        // store. This box re-signs HTTPS via a TLS-interception proxy, so without
        // --use-system-ca the FTPS connect + GitHub README fetch fail cert
        // validation. `npm run deploy` passes this flag; the exe must too, or
        // deploying through the published artifact (the primary launch path)
        // breaks while `npm run deploy` works.
        psi.ArgumentList.Add("--use-system-ca");
        foreach (var a in args) psi.ArgumentList.Add(a);

        // Escape the joined args / repo path: a forwarded value (a --ref, or a
        // --siblings-root/--themes-root path) can contain '[', which AnsiConsole
        // would parse as a markup tag and throw on, aborting before node runs.
        AnsiConsole.MarkupLine($"[grey]> node --use-system-ca {Markup.Escape(string.Join(' ', args))}[/]");
        AnsiConsole.MarkupLine($"[grey]  cwd: {Markup.Escape(_repoRoot)}[/]");

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
