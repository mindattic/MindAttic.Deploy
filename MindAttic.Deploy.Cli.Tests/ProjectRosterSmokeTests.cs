using MindAttic.Deploy.Cli.Services;

namespace MindAttic.Deploy.Cli.Tests;

/// <summary>
/// Parses the repo's real projects.json - a bad registry (duplicate or blank slug) breaks
/// every deploy, since --site/--app routing relies on slugs being unique.
/// </summary>
[TestFixture]
public class ProjectRosterSmokeTests
{
    private const string EnvVar = "MINDATTIC_DEPLOY_ROOT";
    private string? originalEnvValue;

    [SetUp]
    public void SetUp()
    {
        originalEnvValue = Environment.GetEnvironmentVariable(EnvVar);
        Environment.SetEnvironmentVariable(EnvVar, null);
    }

    [TearDown]
    public void TearDown() => Environment.SetEnvironmentVariable(EnvVar, originalEnvValue);

    [Test]
    public void RealProjectsJson_ParsesWithUniqueNonBlankSlugs()
    {
        var roster = ProjectRoster.Load();

        Assert.That(roster.Config.Sites, Is.Not.Empty);
        Assert.That(roster.Config.Apps, Is.Not.Empty);

        var siteSlugs = roster.Config.Sites.Select(s => s.Slug).ToList();
        var appSlugs = roster.Config.Apps.Select(a => a.Slug).ToList();

        Assert.That(siteSlugs.All(s => !string.IsNullOrWhiteSpace(s)), Is.True, "every site needs a non-blank slug");
        Assert.That(appSlugs.All(s => !string.IsNullOrWhiteSpace(s)), Is.True, "every app needs a non-blank slug");

        Assert.That(siteSlugs, Is.Unique, "duplicate site slug would break --site routing for every deploy");
        Assert.That(appSlugs, Is.Unique, "duplicate app slug would break --app routing for every deploy");
    }
}
