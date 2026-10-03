using System.Diagnostics;
using MindAttic.Vault.Credentials;
using Spectre.Console;

namespace MindAttic.Deploy.Cli.Services;

/// <summary>Shells into the canonical node `src/deploy.js` pipeline.</summary>
public sealed class DeployRunner
{
    private readonly string _repoRoot;
    public DeployRunner(string repoRoot) => _repoRoot = repoRoot;

    /// <summary>
    /// A member of a linked group (projects.json linkedGroups) deploys the WHOLE group: pin + commit + tag + push,
    /// CDN gate, then FTP for every site. <paramref name="noLink"/> is the escape hatch (named site only).
    /// </summary>
    public int RunSite(string? slug, bool all, bool dryRun, bool noLink = false, bool withTests = false)
    {
        var args = new List<string> { "src/deploy.js" };
        if (all) args.Add("--sites");
        else if (!string.IsNullOrWhiteSpace(slug)) { args.Add("--site"); args.Add(slug); }
        else throw new ArgumentException("RunSite requires either --slug or --all.");
        if (dryRun) args.Add("--dry-run");
        if (noLink) args.Add("--no-link");
        if (withTests) args.Add("--with-tests");
        return RunNode(args);
    }

    /// <summary>Publish MindAttic.Web.Shared and deploy the whole linked group (same as deploying any member site).</summary>
    public int RunUiux(bool dryRun, bool withTests)
    {
        var args = new List<string> { "src/deploy.js", "--uiux" };
        if (dryRun) args.Add("--dry-run");
        if (withTests) args.Add("--with-tests");
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
        // --use-system-ca TLS fails cert
        // validation (FTPS connect, CDN gate). `npm run deploy` passes this flag; the exe must too, or
        // deploying through the published artifact (the primary launch path)
        // breaks while `npm run deploy` works.
        psi.ArgumentList.Add("--use-system-ca");
        foreach (var a in args) psi.ArgumentList.Add(a);

        // deploy.js already supports MINDATTIC_FTP_JSON as a credential source
        // (checked before secrets/ftp.json) - CI has used it for years via a
        // GitHub Actions secret. Bridge Vault into that same seam: when
        // %APPDATA%\MindAttic\Ftp\ftp.json has credentials, forward them as the
        // env var so deploy.js needs no changes. Leave the inherited environment
        // untouched when Vault has nothing - CI's own MINDATTIC_FTP_JSON and a
        // developer's secrets/ftp.json fallback both keep working unmodified.
        var ftpJson = FtpCredentialStore.Default.TryGetJson();
        if (ftpJson is not null)
        {
            psi.EnvironmentVariables["MINDATTIC_FTP_JSON"] = ftpJson;
            AnsiConsole.MarkupLine("[grey]  ftp:  MindAttic.Vault (%APPDATA%\\MindAttic\\Ftp\\ftp.json)[/]");
        }

        // Escape the joined args / repo path: a forwarded value (a slug, or the
        // repo path) can contain '[', which AnsiConsole
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
