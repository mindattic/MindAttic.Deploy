using System.ComponentModel;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

/// <summary>
/// Non-interactive "deploy everything" — runs every catalog page, every root
/// site, and every app (including disabled stubs, so the user sees the per-stub
/// note exactly once) back-to-back. Mirrors what MainMenuCommand does when the
/// user toggles every box; exists as its own command so external launchers
/// (MindAttic.Console's Deploy All menu, CI, slash commands) don't have to
/// drive an interactive prompt.
/// </summary>
public sealed class AllCommand : Command<AllCommand.Settings>
{
    public sealed class Settings : CommandSettings
    {
        [CommandOption("--dry-run")]
        [Description("Run preDeploy hooks + build but skip FTP uploads and CI pushes.")]
        public bool DryRun { get; set; }
    }

    public override int Execute(CommandContext context, Settings settings)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);

        AnsiConsole.Write(new Rule("[cyan1]MindAttic.Deploy — all[/]").LeftJustified());
        AnsiConsole.MarkupLine($"[grey]repo: {roster.RepoRoot}[/]");
        var totals = $"{roster.Config.Projects.Count} catalog + {roster.Config.Sites.Count} site(s) + {roster.Config.Apps.Count} app(s)";
        AnsiConsole.MarkupLine($"[grey]targets: {totals}[/]");
        if (settings.DryRun)
            AnsiConsole.MarkupLine("[yellow]--dry-run: no FTP uploads or CI pushes will execute.[/]");
        AnsiConsole.WriteLine();

        int failed = 0;

        if (roster.Config.Projects.Count > 0)
        {
            AnsiConsole.WriteLine();
            AnsiConsole.Write(new Rule("[cyan]catalog: all[/]").LeftJustified());
            // null OnlySlugs => deploy every catalog entry in one node invocation.
            int code = runner.RunCatalog(onlySlugs: null, skipBuild: false, dryRun: settings.DryRun);
            if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
        }

        if (roster.Config.Sites.Count > 0)
        {
            AnsiConsole.WriteLine();
            AnsiConsole.Write(new Rule("[cyan]sites: --all[/]").LeftJustified());
            int code = runner.RunSite(slug: null, all: true, dryRun: settings.DryRun);
            if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
        }

        if (roster.Config.Apps.Count > 0)
        {
            AnsiConsole.WriteLine();
            AnsiConsole.Write(new Rule("[cyan]apps: --all --include-disabled[/]").LeftJustified());
            // includeDisabled: true matches MainMenuCommand's all-apps path —
            // surfaces each disabled stub's note once instead of silently skipping.
            int code = runner.RunApp(slug: null, all: true, dryRun: settings.DryRun, includeDisabled: true);
            if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
        }

        AnsiConsole.WriteLine();
        AnsiConsole.Write(new Rule().LeftJustified());
        if (failed > 0)
        {
            AnsiConsole.MarkupLine($"[red]{failed} batch(es) failed.[/]");
            return 1;
        }
        AnsiConsole.MarkupLine("[green]All batches completed.[/]");
        return 0;
    }
}
