using System.ComponentModel;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

public sealed class AppCommand : Command<AppCommand.Settings>
{
    public sealed class Settings : CommandSettings
    {
        [CommandOption("--slug <SLUG>")]
        [Description("Deploy a single Blazor / GitHub-Actions app by slug.")]
        public string? Slug { get; set; }

        [CommandOption("--all")]
        [Description("Deploy every enabled app.")]
        public bool All { get; set; }

        [CommandOption("--dry-run")]
        [Description("Run preDeploy hooks; report planned commit/push without executing.")]
        public bool DryRun { get; set; }

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
        return runner.RunApp(settings.Slug, settings.All, settings.DryRun);
    }
}
