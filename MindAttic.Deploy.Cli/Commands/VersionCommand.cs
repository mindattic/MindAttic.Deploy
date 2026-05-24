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
        // Assembly.Location is empty when packed into a single-file publish
        // (IL3000). Use the process path instead, so --version shows where the
        // exe actually lives whether you launched it via `dotnet run`, the
        // unpacked dll, or the published artifacts\MindAttic.Deploy.exe.
        var location = Environment.ProcessPath ?? AppContext.BaseDirectory;
        AnsiConsole.MarkupLine($"[bold]{name}[/] [grey]{version}[/]");
        AnsiConsole.MarkupLine($"[grey]{location}[/]");
        return 0;
    }
}
