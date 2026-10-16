using System.Text.Json;
using MindAttic.Deploy.Cli.Models;

namespace MindAttic.Deploy.Cli.Tests;

[TestFixture]
public class DeployConfigTests
{
    // Mirrors the options ProjectRoster.Load uses - projects.json is hand-edited and carries
    // both $comment-style fields and trailing commas.
    private static readonly JsonSerializerOptions Options = new()
    {
        AllowTrailingCommas = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    private static DeployConfig Parse(string json) =>
        JsonSerializer.Deserialize<DeployConfig>(json, Options)!;

    [Test]
    public void Deserialize_TolerateComments_AndTrailingCommas()
    {
        const string json = """
        {
          // a line comment on the registry
          "sites": [
            {
              "slug": "mindattic.com", // trailing comma below is intentional
              "sourceDir": "../MindAttic.Web/mindattic.com",
              "ftpRemotePath": "/",
            },
          ],
          "apps": [],
        }
        """;

        var config = Parse(json);

        Assert.That(config.Sites, Has.Count.EqualTo(1));
        Assert.That(config.Sites[0].Slug, Is.EqualTo("mindattic.com"));
    }

    [Test]
    public void Deserialize_AppliesDefaults_WhenFieldsOmitted()
    {
        const string json = """
        {
          "sites": [ { "slug": "bare-site" } ],
          "apps": [ { "slug": "bare-app" } ],
          "linkedGroups": {
            "g": { "package": { "slug": "pkg" } }
          }
        }
        """;

        var config = Parse(json);

        var app = config.Apps.Single();
        Assert.That(app.Branch, Is.EqualTo("main"));
        Assert.That(app.Disabled, Is.False);
        Assert.That(app.DisabledNote, Is.Null);
        Assert.That(app.StageOnly, Is.Empty);
        Assert.That(app.PreDeploy, Is.Empty);

        var site = config.Sites.Single();
        Assert.That(site.Files, Is.Empty);
        Assert.That(site.PreDeploy, Is.Empty);
        Assert.That(site.StampFile, Is.Null);
        Assert.That(site.PinFiles, Is.Null);

        var package = config.LinkedGroups["g"].Package;
        Assert.That(package.Branch, Is.EqualTo("main"));
        Assert.That(package.Remote, Is.EqualTo("origin"));
        Assert.That(config.LinkedGroups["g"].Sites, Is.Empty);
    }

    [Test]
    public void Deserialize_DefaultsToEmptyRegistry_WhenFieldsOmittedEntirely()
    {
        var config = Parse("{}");

        Assert.That(config.LinkedGroups, Is.Empty);
        Assert.That(config.Sites, Is.Empty);
        Assert.That(config.Apps, Is.Empty);
    }

    [Test]
    public void RoundTrips_LinkedGroup_SitesAppsAndPreDeployHooks()
    {
        const string json = """
        {
          "linkedGroups": {
            "mindattic-web": {
              "package": {
                "slug": "MindAttic.Components",
                "sourceDir": "../MindAttic.Components",
                "repo": "mindattic/MindAttic.Components",
                "branch": "trunk",
                "remote": "upstream",
                "cdnSubpath": "web",
                "firstTag": "V1"
              },
              "sites": ["mindattic.com", "hyperspace"]
            }
          },
          "sites": [
            {
              "slug": "mindattic.com",
              "sourceDir": "../MindAttic.Web/mindattic.com",
              "ftpRemotePath": "/",
              "files": ["index.htm", "about.htm"],
              "stampFile": "index.htm",
              "pinFiles": ["index.htm"],
              "preDeploy": [
                { "kind": "package-pull", "required": true },
                { "kind": "powershell", "file": "sync.ps1", "tagArg": "-CdnTag", "args": ["-Quiet"] }
              ]
            }
          ],
          "apps": [
            {
              "slug": "thinktank",
              "sourceDir": "../ThinkTank",
              "repo": "mindattic/ThinkTank",
              "branch": "release",
              "workflow": "azure-deploy.yml",
              "disabled": true,
              "disabledNote": "paused",
              "stageOnly": ["wwwroot"],
              "commitMessage": "Sync for deploy ({utc})",
              "preDeploy": [
                { "kind": "dotnet-build", "project": "ThinkTank.csproj", "configuration": "Release", "required": true }
              ]
            }
          ]
        }
        """;

        var config = Parse(json);

        var group = config.LinkedGroups["mindattic-web"];
        Assert.That(group.Package.Slug, Is.EqualTo("MindAttic.Components"));
        Assert.That(group.Package.Branch, Is.EqualTo("trunk"));
        Assert.That(group.Package.Remote, Is.EqualTo("upstream"));
        Assert.That(group.Package.CdnSubpath, Is.EqualTo("web"));
        Assert.That(group.Package.FirstTag, Is.EqualTo("V1"));
        Assert.That(group.Sites, Is.EqualTo(new[] { "mindattic.com", "hyperspace" }));

        var site = config.Sites.Single();
        Assert.That(site.Files, Is.EqualTo(new[] { "index.htm", "about.htm" }));
        Assert.That(site.StampFile, Is.EqualTo("index.htm"));
        Assert.That(site.PinFiles, Is.EqualTo(new[] { "index.htm" }));
        Assert.That(site.PreDeploy, Has.Count.EqualTo(2));
        Assert.That(site.PreDeploy[0].Kind, Is.EqualTo("package-pull"));
        Assert.That(site.PreDeploy[0].Required, Is.True);
        Assert.That(site.PreDeploy[1].TagArg, Is.EqualTo("-CdnTag"));
        Assert.That(site.PreDeploy[1].Args, Is.EqualTo(new[] { "-Quiet" }));

        var app = config.Apps.Single();
        Assert.That(app.Disabled, Is.True);
        Assert.That(app.DisabledNote, Is.EqualTo("paused"));
        Assert.That(app.StageOnly, Is.EqualTo(new[] { "wwwroot" }));
        Assert.That(app.CommitMessage, Is.EqualTo("Sync for deploy ({utc})"));
        Assert.That(app.PreDeploy.Single().Project, Is.EqualTo("ThinkTank.csproj"));
        Assert.That(app.PreDeploy.Single().Configuration, Is.EqualTo("Release"));
    }
}
