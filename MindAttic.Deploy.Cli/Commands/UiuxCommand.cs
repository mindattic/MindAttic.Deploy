using System.ComponentModel;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

/// <summary>
/// `MindAttic.Deploy uiux` -- publish the MindAttic.UiUx package (tag + push) and deploy the whole linked group
/// (ryandebraal.com, mindatticcares.com, mindattic.com). Identical to deploying any member site; shells into
/// `node src/deploy.js --uiux`. See src/linked.js.
/// </summary>
public sealed class UiuxCommand : Command<UiuxCommand.Settings>
{
    public sealed class Settings : CommandSettings
    {
        [CommandOption("--dry-run")]
        [Description("Preview only: nothing is tagged, pushed, written or uploaded.")]
        public bool DryRun { get; set; }

        [CommandOption("--with-tests")]
        [Description("Also run MindAttic.UiUx/tests (npm run test:local) as a gate before publishing.")]
        public bool WithTests { get; set; }
    }

    public override int Execute(CommandContext context, Settings settings)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);
        return runner.RunUiux(settings.DryRun, settings.WithTests);
    }
}
