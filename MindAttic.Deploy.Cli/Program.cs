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

    config.AddCommand<SiteCommand>("site")
        .WithDescription("Deploy a root site (verbatim FTPS upload).")
        .WithExample("site", "--slug", "mindattic.com")
        .WithExample("site", "--slug", "mindattic.com", "--dry-run")
        .WithExample("site", "--slug", "mindattic.com", "--no-link")
        .WithExample("site", "--all");

    config.AddCommand<UiuxCommand>("uiux")
        .WithAlias("package")
        .WithDescription("Publish MindAttic.Web.Shared (pin, commit, tag + push MindAttic.Web), verify the CDN, then deploy every linked site.")
        .WithExample("uiux")
        .WithExample("uiux", "--dry-run")
        .WithExample("uiux", "--with-tests");

    config.AddCommand<AppCommand>("app")
        .WithDescription("Deploy a Blazor / GitHub-Actions-driven app.")
        .WithExample("app", "--slug", "prose")
        .WithExample("app", "--slug", "prose", "--dry-run")
        .WithExample("app", "--all");

    config.AddCommand<AllCommand>("all")
        .WithDescription("Deploy every root site and app (non-interactive).")
        .WithExample("all")
        .WithExample("all", "--dry-run");

    config.AddCommand<ListCommand>("list")
        .WithDescription("Print every deploy target (sites, apps) with slugs + status.");

    config.AddCommand<VersionCommand>("version")
        .WithAlias("--version")
        .WithDescription("Print version and exe path.");
});

return await app.RunAsync(args);
