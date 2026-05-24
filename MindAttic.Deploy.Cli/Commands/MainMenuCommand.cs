using MindAttic.Deploy.Cli.Models;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

/// <summary>Default command (no args). Interactive multi-select prompt across catalog + sites + apps.</summary>
public sealed class MainMenuCommand : Command
{
    private const string CatalogPrefix = "catalog:";
    private const string SitePrefix    = "site:";
    private const string AppPrefix     = "app:";

    public override int Execute(CommandContext context)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);

        AnsiConsole.Write(new FigletText("MindAttic.Deploy").Color(Color.Cyan1));
        AnsiConsole.MarkupLine($"[grey]repo: {roster.RepoRoot}[/]");
        AnsiConsole.WriteLine();

        var prompt = new MultiSelectionPrompt<string>()
            .Title("Pick what to [yellow]deploy[/] ([grey]space[/]=toggle, [grey]A[/]=all, [grey]Enter[/]=confirm):")
            .PageSize(30)
            .InstructionsText("[grey](nothing selected = exit without deploying)[/]")
            .UseConverter(LabelFor(roster.Config));

        if (roster.Config.Projects.Count > 0)
        {
            prompt.AddChoiceGroup("Catalog landing pages (mindattic.com/<slug>.htm)",
                roster.Config.Projects.Select(p => CatalogPrefix + p.Slug));
        }
        if (roster.Config.Sites.Count > 0)
        {
            prompt.AddChoiceGroup("Root sites (verbatim FTP upload)",
                roster.Config.Sites.Select(s => SitePrefix + s.Slug));
        }
        if (roster.Config.Apps.Count > 0)
        {
            prompt.AddChoiceGroup("Apps (Blazor / GitHub Actions)",
                roster.Config.Apps.Select(a => AppPrefix + a.Slug));
        }

        var picks = AnsiConsole.Prompt(prompt);
        if (picks.Count == 0)
        {
            AnsiConsole.MarkupLine("[grey]Nothing selected; exiting.[/]");
            return 0;
        }

        AnsiConsole.WriteLine();
        AnsiConsole.MarkupLine($"[bold]Deploying {picks.Count} target(s)...[/]");

        int failed = 0;
        foreach (var pick in picks)
        {
            AnsiConsole.WriteLine();
            AnsiConsole.Write(new Rule($"[cyan]{pick}[/]").LeftJustified());
            int code = pick switch
            {
                _ when pick.StartsWith(CatalogPrefix) => runner.RunCatalog(pick[CatalogPrefix.Length..], skipBuild: false),
                _ when pick.StartsWith(SitePrefix)    => runner.RunSite(pick[SitePrefix.Length..], all: false),
                _ when pick.StartsWith(AppPrefix)     => runner.RunApp(pick[AppPrefix.Length..], all: false, dryRun: false),
                _ => 1,
            };
            if (code != 0)
            {
                failed++;
                AnsiConsole.MarkupLine($"[red]Exit {code}[/]");
            }
        }

        AnsiConsole.WriteLine();
        AnsiConsole.Write(new Rule().LeftJustified());
        if (failed > 0)
        {
            AnsiConsole.MarkupLine($"[red]{failed}/{picks.Count} target(s) failed.[/]");
            return 1;
        }
        AnsiConsole.MarkupLine($"[green]All {picks.Count} target(s) deployed.[/]");
        return 0;
    }

    private static Func<string, string> LabelFor(DeployConfig cfg) => key =>
    {
        if (key.StartsWith(CatalogPrefix))
        {
            var slug = key[CatalogPrefix.Length..];
            var p = cfg.Projects.FirstOrDefault(x => x.Slug == slug);
            var theme = p?.Theme is { Length: > 0 } t ? $" [grey]({t})[/]" : "";
            return $"{slug}{theme}";
        }
        if (key.StartsWith(SitePrefix))
        {
            var slug = key[SitePrefix.Length..];
            var s = cfg.Sites.FirstOrDefault(x => x.Slug == slug);
            return $"{slug} [grey]-> {s?.FtpRemotePath}[/]";
        }
        if (key.StartsWith(AppPrefix))
        {
            var slug = key[AppPrefix.Length..];
            var a = cfg.Apps.FirstOrDefault(x => x.Slug == slug);
            var status = a?.Disabled == true ? " [red](disabled)[/]" : "";
            return $"{slug} [grey]-> {a?.Repo}@{a?.Branch}[/]{status}";
        }
        return key;
    };
}
