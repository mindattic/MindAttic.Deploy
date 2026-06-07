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

        AnsiConsole.Write(new Rule("[cyan1]MindAttic.Deploy[/]").LeftJustified());
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

        var catalogPicks = picks.Where(p => p.StartsWith(CatalogPrefix)).Select(p => p[CatalogPrefix.Length..]).ToList();
        var sitePicks    = picks.Where(p => p.StartsWith(SitePrefix))   .Select(p => p[SitePrefix.Length..])   .ToList();
        var appPicks     = picks.Where(p => p.StartsWith(AppPrefix))    .Select(p => p[AppPrefix.Length..])    .ToList();

        AnsiConsole.WriteLine();
        AnsiConsole.MarkupLine($"[bold]Deploying {picks.Count} target(s) in {Batches(catalogPicks, sitePicks, appPicks, roster.Config)} batch(es)...[/]");

        int failed = 0;

        if (catalogPicks.Count > 0)
        {
            AnsiConsole.WriteLine();
            AnsiConsole.Write(new Rule($"[cyan]catalog: {Markup.Escape(string.Join(", ", catalogPicks))}[/]").LeftJustified());
            // One node invocation builds all selected slugs once, then uploads each.
            int code = runner.RunCatalog(catalogPicks, skipBuild: false, dryRun: false);
            if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
        }

        if (sitePicks.Count > 0)
        {
            if (sitePicks.Count == roster.Config.Sites.Count)
            {
                AnsiConsole.WriteLine();
                AnsiConsole.Write(new Rule("[cyan]sites: --all[/]").LeftJustified());
                int code = runner.RunSite(slug: null, all: true, dryRun: false);
                if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
            }
            else
            {
                foreach (var slug in sitePicks)
                {
                    AnsiConsole.WriteLine();
                    AnsiConsole.Write(new Rule($"[cyan]site: {Markup.Escape(slug)}[/]").LeftJustified());
                    int code = runner.RunSite(slug, all: false, dryRun: false);
                    if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
                }
            }
        }

        if (appPicks.Count > 0)
        {
            // Every app in the prompt was picked (including disabled ones — the prompt
            // lists them all). Collapse to `--apps --include-disabled` so the user sees
            // each disabled note exactly once instead of N times in a single-app loop.
            var allAppsPicked = appPicks.Count == roster.Config.Apps.Count;
            if (allAppsPicked)
            {
                AnsiConsole.WriteLine();
                AnsiConsole.Write(new Rule("[cyan]apps: --all[/]").LeftJustified());
                int code = runner.RunApp(slug: null, all: true, dryRun: false, includeDisabled: true);
                if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
            }
            else
            {
                foreach (var slug in appPicks)
                {
                    AnsiConsole.WriteLine();
                    AnsiConsole.Write(new Rule($"[cyan]app: {Markup.Escape(slug)}[/]").LeftJustified());
                    int code = runner.RunApp(slug, all: false, dryRun: false, includeDisabled: false);
                    if (code != 0) { failed++; AnsiConsole.MarkupLine($"[red]Exit {code}[/]"); }
                }
            }
        }

        AnsiConsole.WriteLine();
        AnsiConsole.Write(new Rule().LeftJustified());
        if (failed > 0)
        {
            AnsiConsole.MarkupLine($"[red]{failed} batch(es) failed.[/]");
            return 1;
        }
        AnsiConsole.MarkupLine($"[green]All {picks.Count} target(s) deployed.[/]");
        return 0;
    }

    private static int Batches(List<string> catalog, List<string> sites, List<string> apps, DeployConfig cfg)
    {
        int n = 0;
        if (catalog.Count > 0) n += 1;
        if (sites.Count > 0)   n += sites.Count == cfg.Sites.Count ? 1 : sites.Count;
        if (apps.Count > 0)    n += apps.Count == cfg.Apps.Count ? 1 : apps.Count;
        return n;
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
