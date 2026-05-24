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

        // Forwarded straight through to src/build.js (deploy.js -> runBuild).
        // Needed so CI can drive the CLI the same way it drives `npm run deploy`.
        [CommandOption("--from-github")]
        [Description("Force README fetch from GitHub raw; skip sibling lookup.")]
        public bool FromGithub { get; set; }

        [CommandOption("--ref <REF>")]
        [Description("Git ref for README fetch (default: main).")]
        public string? Ref { get; set; }

        [CommandOption("--siblings-root <PATH>")]
        [Description("Override the sibling-repo lookup root.")]
        public string? SiblingsRoot { get; set; }

        [CommandOption("--themes-root <PATH>")]
        [Description("Path to MindAttic.UiUx/Themes (default: ../MindAttic.UiUx/Themes).")]
        public string? ThemesRoot { get; set; }

        [CommandOption("--components <REF>")]
        [Description("Override the MindAttic.UiUx CDN ref pinned in projects.json.")]
        public string? Components { get; set; }
    }

    public override int Execute(CommandContext context, Settings settings)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);
        return runner.RunCatalog(
            settings.OnlySlugs, settings.SkipBuild, settings.DryRun,
            settings.FromGithub, settings.Ref, settings.SiblingsRoot, settings.ThemesRoot, settings.Components);
    }
}
