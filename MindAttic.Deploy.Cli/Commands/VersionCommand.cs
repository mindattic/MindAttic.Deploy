using System.Reflection;
using Spectre.Console;
using Spectre.Console.Cli;

namespace MindAttic.Deploy.Cli.Commands;

public sealed class VersionCommand : Command
{
    public override int Execute(CommandContext context)
    {
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetName().Name ?? "MindAttic.Deploy";
        var version = asm.GetName().Version?.ToString() ?? "?";
        var location = asm.Location;
        AnsiConsole.MarkupLine($"[bold]{name}[/] [grey]{version}[/]");
        AnsiConsole.MarkupLine($"[grey]{location}[/]");
        return 0;
    }
}
