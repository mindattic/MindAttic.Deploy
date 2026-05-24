using System.ComponentModel;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

public sealed class CatalogCommand : Command<CatalogCommand.Settings>
{
    public sealed class Settings : CommandSettings
    {
        [CommandOption("--only <SLUG>")]
        [Description("Deploy a single catalog landing page by slug. Repeatable.")]
        public string[]? OnlySlugs { get; set; }

        [CommandOption("--skip-build")]
        [Description("Skip the implicit build step.")]
        public bool SkipBuild { get; set; }

        [CommandOption("--dry-run")]
        [Description("Build to out/ but skip the FTP upload; preview what would deploy.")]
        public bool DryRun { get; set; }
    }

    public override int Execute(CommandContext context, Settings settings)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);
        return runner.RunCatalog(settings.OnlySlugs, settings.SkipBuild, settings.DryRun);
    }
}
