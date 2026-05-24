using MindAttic.Deploy.Cli.Commands;
using Spectre.Console.Cli;

// CommandApp<T> with a typed default eats top-level options before any command-name lookup,
// so `--version` / `-v` would fall through to the menu unless we short-circuit here.
if (args.Length == 1 && (args[0] == "--version" || args[0] == "-v"))
{
    return new VersionCommand().Execute(null!);
}

var app = new CommandApp<MainMenuCommand>();

app.Configure(config =>
{
    config.SetApplicationName("MindAttic.Deploy");

    config.AddCommand<CatalogCommand>("catalog")
        .WithDescription("Deploy catalog landing pages (mindattic.com/<slug>.htm).")
        .WithExample("catalog")
        .WithExample("catalog", "--only", "mindatticvault")
        .WithExample("catalog", "--only", "claudia", "--skip-build");

    config.AddCommand<SiteCommand>("site")
        .WithDescription("Deploy a root site (verbatim FTPS upload).")
        .WithExample("site", "--slug", "mindattic.com")
        .WithExample("site", "--all");

    config.AddCommand<AppCommand>("app")
        .WithDescription("Deploy a Blazor / GitHub-Actions-driven app.")
        .WithExample("app", "--slug", "streetsamurai")
        .WithExample("app", "--slug", "streetsamurai", "--dry-run")
        .WithExample("app", "--all");

    config.AddCommand<VersionCommand>("version")
        .WithAlias("--version")
        .WithDescription("Print version and exe path.");
});

return await app.RunAsync(args);
