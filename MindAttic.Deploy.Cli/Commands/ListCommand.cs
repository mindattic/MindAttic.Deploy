using MindAttic.Deploy.Cli.Services;
using Spectre.Console;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

/// <summary>Print every deploy target across the three axes.</summary>
public sealed class ListCommand : Command
{
    public override int Execute(CommandContext context)
    {
        var roster = ProjectRoster.Load();
        var cfg = roster.Config;

        AnsiConsole.MarkupLine($"[grey]repo: {roster.RepoRoot}[/]");

        if (cfg.Projects.Count > 0)
        {
            var t = new Table()
                .Title($"[cyan]Catalog landing pages ({cfg.Projects.Count})[/]")
                .Border(TableBorder.SimpleHeavy)
                .AddColumn("slug")
                .AddColumn("repo")
                .AddColumn("theme");
            foreach (var p in cfg.Projects)
                t.AddRow(Markup.Escape(p.Slug), Markup.Escape(p.Repo), Markup.Escape(p.Theme ?? ""));
            AnsiConsole.Write(t);
        }

        if (cfg.Sites.Count > 0)
        {
            var t = new Table()
                .Title($"[cyan]Root sites ({cfg.Sites.Count})[/]")
                .Border(TableBorder.SimpleHeavy)
                .AddColumn("slug")
                .AddColumn("sourceDir")
                .AddColumn("remote");
            foreach (var s in cfg.Sites)
                t.AddRow(Markup.Escape(s.Slug), Markup.Escape(s.SourceDir), Markup.Escape(s.FtpRemotePath));
            AnsiConsole.Write(t);
        }

        if (cfg.Apps.Count > 0)
        {
            var enabled = cfg.Apps.Count(a => !a.Disabled);
            var t = new Table()
                .Title($"[cyan]Apps ({enabled} enabled, {cfg.Apps.Count - enabled} disabled)[/]")
                .Border(TableBorder.SimpleHeavy)
                .AddColumn("slug")
                .AddColumn("repo")
                .AddColumn("branch")
                .AddColumn("workflow")
                .AddColumn("status");
            foreach (var a in cfg.Apps)
            {
                var status = a.Disabled ? "[red]disabled[/]" : "[green]enabled[/]";
                // status is intentional markup; the rest is config data -> escape.
                t.AddRow(Markup.Escape(a.Slug), Markup.Escape(a.Repo), Markup.Escape(a.Branch), Markup.Escape(a.Workflow), status);
            }
            AnsiConsole.Write(t);
        }

        return 0;
    }
}
