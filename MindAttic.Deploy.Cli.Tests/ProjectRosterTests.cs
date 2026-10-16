using MindAttic.Deploy.Cli.Services;

namespace MindAttic.Deploy.Cli.Tests;

[TestFixture]
public class ProjectRosterTests
{
    private const string EnvVar = "MINDATTIC_DEPLOY_ROOT";

    private string tempRoot = null!;
    private string? originalEnvValue;

    [SetUp]
    public void SetUp()
    {
        tempRoot = Path.Combine(Path.GetTempPath(), $"mindattic-deploy-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);
        originalEnvValue = Environment.GetEnvironmentVariable(EnvVar);
        Environment.SetEnvironmentVariable(EnvVar, null);
    }

    [TearDown]
    public void TearDown()
    {
        Environment.SetEnvironmentVariable(EnvVar, originalEnvValue);
        if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, recursive: true);
    }

    private static void MakeRepoRoot(string dir, string projectsJson = "{}")
    {
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "projects.json"), projectsJson);
        Directory.CreateDirectory(Path.Combine(dir, "src"));
        File.WriteAllText(Path.Combine(dir, "src", "deploy.js"), "// stub");
    }

    private string MakeNestedStartDir(string repoRoot)
    {
        var nested = Path.Combine(repoRoot, "mid", "start");
        Directory.CreateDirectory(nested);
        return nested;
    }

    [Test]
    public void ResolveRepoRoot_HonoursEnvVar_WhenDirExists()
    {
        var envDir = Path.Combine(tempRoot, "env-root");
        MakeRepoRoot(envDir);
        Environment.SetEnvironmentVariable(EnvVar, envDir);

        // startDir points somewhere unrelated, proving the env var wins outright.
        var unrelatedStart = Path.Combine(tempRoot, "unrelated");
        Directory.CreateDirectory(unrelatedStart);

        var resolved = ProjectRoster.ResolveRepoRoot(unrelatedStart);

        Assert.That(resolved, Is.EqualTo(Path.GetFullPath(envDir)));
    }

    [TestCase("")]
    [TestCase("   ")]
    public void ResolveRepoRoot_IgnoresEnvVar_WhenBlank(string blankValue)
    {
        var realRoot = Path.Combine(tempRoot, "real-root");
        MakeRepoRoot(realRoot);
        var startDir = MakeNestedStartDir(realRoot);
        Environment.SetEnvironmentVariable(EnvVar, blankValue);

        var resolved = ProjectRoster.ResolveRepoRoot(startDir);

        Assert.That(resolved, Is.EqualTo(Path.GetFullPath(realRoot)));
    }

    [Test]
    public void ResolveRepoRoot_IgnoresEnvVar_WhenDirMissing()
    {
        var realRoot = Path.Combine(tempRoot, "real-root");
        MakeRepoRoot(realRoot);
        var startDir = MakeNestedStartDir(realRoot);
        Environment.SetEnvironmentVariable(EnvVar, Path.Combine(tempRoot, $"does-not-exist-{Guid.NewGuid():N}"));

        var resolved = ProjectRoster.ResolveRepoRoot(startDir);

        Assert.That(resolved, Is.EqualTo(Path.GetFullPath(realRoot)));
    }

    [Test]
    public void ResolveRepoRoot_WalksUpFromStartDir_ToFirstFolderWithBothMarkers()
    {
        var realRoot = Path.Combine(tempRoot, "real-root");
        MakeRepoRoot(realRoot);
        var startDir = MakeNestedStartDir(realRoot);

        var resolved = ProjectRoster.ResolveRepoRoot(startDir);

        Assert.That(resolved, Is.EqualTo(Path.GetFullPath(realRoot)));
    }

    [Test]
    public void ResolveRepoRoot_SkipsAFolderThatOnlyHasProjectsJson()
    {
        var realRoot = Path.Combine(tempRoot, "real-root");
        MakeRepoRoot(realRoot);

        // An intermediate folder carries projects.json but not src/deploy.js - it must not
        // be mistaken for the repo root; the walk continues up to the real one.
        var decoy = Path.Combine(realRoot, "decoy");
        Directory.CreateDirectory(decoy);
        File.WriteAllText(Path.Combine(decoy, "projects.json"), "{}");

        var startDir = Path.Combine(decoy, "start");
        Directory.CreateDirectory(startDir);

        var resolved = ProjectRoster.ResolveRepoRoot(startDir);

        Assert.That(resolved, Is.EqualTo(Path.GetFullPath(realRoot)));
    }

    [Test]
    public void ResolveRepoRoot_Throws_InvalidOperationException_WhenNoAncestorHasBothMarkers()
    {
        var isolatedStart = Path.Combine(tempRoot, "isolated", "start");
        Directory.CreateDirectory(isolatedStart);

        Assert.Throws<InvalidOperationException>(() => ProjectRoster.ResolveRepoRoot(isolatedStart));
    }

    [Test]
    public void Load_Throws_FileNotFoundException_WhenProjectsJsonMissing()
    {
        var dirWithoutProjectsJson = Path.Combine(tempRoot, "no-projects-json");
        Directory.CreateDirectory(dirWithoutProjectsJson);
        Environment.SetEnvironmentVariable(EnvVar, dirWithoutProjectsJson);

        Assert.Throws<FileNotFoundException>(() => ProjectRoster.Load(tempRoot));
    }

    [Test]
    public void Load_ReturnsConfig_ForValidRepoRoot()
    {
        var realRoot = Path.Combine(tempRoot, "real-root");
        MakeRepoRoot(realRoot, """{ "sites": [], "apps": [] }""");

        var roster = ProjectRoster.Load(realRoot);

        Assert.That(roster.RepoRoot, Is.EqualTo(Path.GetFullPath(realRoot)));
        Assert.That(roster.Config, Is.Not.Null);
    }
}
