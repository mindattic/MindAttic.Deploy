using System.ComponentModel;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

public sealed class SiteCommand : Command<SiteCommand.Settings>
{
    public sealed class Settings : CommandSettings
    {
        [CommandOption("--slug <SLUG>")]
        [Description("Deploy a root site by slug. A member of the linked MindAttic.Web group (ryandebraal.com, mindatticcares.com, hyperspace, mindattic.com) deploys the WHOLE group.")]
        public string? Slug { get; set; }

        [CommandOption("--all")]
        [Description("Deploy every root site.")]
        public bool All { get; set; }

        [CommandOption("--dry-run")]
        [Description("Preview only: nothing is written, committed, tagged, pushed or uploaded (linked groups skip the mutating hooks).")]
        public bool DryRun { get; set; }

        [CommandOption("--no-link")]
        [Description("ESCAPE HATCH: deploy only the named site, skipping the linked publish/pin/CDN-gate flow.")]
        public bool NoLink { get; set; }

        [CommandOption("--with-tests")]
        [Description("Linked deploy: also run MindAttic.Web.Shared/tests as a gate before publishing.")]
        public bool WithTests { get; set; }

        public override Spectre.Console.ValidationResult Validate()
        {
            if (string.IsNullOrWhiteSpace(Slug) && !All)
                return Spectre.Console.ValidationResult.Error("Pass --slug <SLUG> or --all.");
            return Spectre.Console.ValidationResult.Success();
        }
    }

    public override int Execute(CommandContext context, Settings settings)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);
        return runner.RunSite(settings.Slug, settings.All, settings.DryRun, settings.NoLink, settings.WithTests);
    }
}
