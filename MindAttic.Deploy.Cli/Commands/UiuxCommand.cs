using System.ComponentModel;
using MindAttic.Deploy.Cli.Services;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

/// <summary>
/// `MindAttic.Deploy uiux` -- publish MindAttic.Web.Shared (pin, commit, tag + push the MindAttic.Web monorepo) and deploy
/// the whole linked group (ryandebraal.com, mindatticcares.com, hyperspace, mindattic.com). Identical to deploying any
/// member site; shells into
/// `node src/deploy.js --uiux`. See src/linked.js.
/// </summary>
public sealed class UiuxCommand : Command<UiuxCommand.Settings>
{
    public sealed class Settings : CommandSettings
    {
        [CommandOption("--dry-run")]
        [Description("Preview only: nothing is written, committed, tagged, pushed or uploaded.")]
        public bool DryRun { get; set; }

        [CommandOption("--with-tests")]
        [Description("Also run MindAttic.Web.Shared/tests (npm run test:local) as a gate before publishing.")]
        public bool WithTests { get; set; }
    }

    public override int Execute(CommandContext context, Settings settings)
    {
        var roster = ProjectRoster.Load();
        var runner = new DeployRunner(roster.RepoRoot);
        return runner.RunUiux(settings.DryRun, settings.WithTests);
    }
}
