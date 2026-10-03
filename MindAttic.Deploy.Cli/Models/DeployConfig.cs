using System.Text.Json.Serialization;

namespace MindAttic.Deploy.Cli.Models;

public sealed class DeployConfig
{
    [JsonPropertyName("linkedGroups")] public Dictionary<string, LinkedGroup> LinkedGroups { get; set; } = new();
    [JsonPropertyName("sites")]        public List<SiteProfile> Sites { get; set; } = new();
    [JsonPropertyName("apps")]         public List<AppProfile>  Apps  { get; set; } = new();
}

public sealed class AppProfile
{
    [JsonPropertyName("slug")]          public string  Slug          { get; set; } = "";
    [JsonPropertyName("sourceDir")]     public string  SourceDir     { get; set; } = "";
    [JsonPropertyName("repo")]          public string  Repo          { get; set; } = "";
    [JsonPropertyName("branch")]        public string  Branch        { get; set; } = "main";
    [JsonPropertyName("workflow")]      public string  Workflow      { get; set; } = "";
    [JsonPropertyName("disabled")]      public bool    Disabled      { get; set; }
    [JsonPropertyName("disabledNote")]  public string? DisabledNote  { get; set; }
    [JsonPropertyName("stageOnly")]     public List<string>     StageOnly     { get; set; } = new();
    [JsonPropertyName("commitMessage")] public string?          CommitMessage { get; set; }
    [JsonPropertyName("preDeploy")]     public List<HookProfile> PreDeploy    { get; set; } = new();
}

/// <summary>A single preDeploy hook entry (package-pull / powershell / dotnet-build).</summary>
public sealed class HookProfile
{
    [JsonPropertyName("kind")]          public string  Kind          { get; set; } = "";
    [JsonPropertyName("file")]          public string? File          { get; set; }
    [JsonPropertyName("project")]       public string? Project       { get; set; }
    [JsonPropertyName("configuration")] public string? Configuration { get; set; }
    [JsonPropertyName("args")]          public List<string> Args      { get; set; } = new();
    [JsonPropertyName("required")]      public bool?   Required      { get; set; }
    /// <summary>Linked deploy: the powershell flag that receives the release tag (e.g. -CyberspaceCdnTag).</summary>
    [JsonPropertyName("tagArg")]        public string? TagArg        { get; set; }
}

/// <summary>
/// A permanently linked set: one monorepo (MindAttic.Web) whose package folder (cdnSubpath, MindAttic.Web.Shared) is served over jsDelivr, plus the sites that
/// consume it. Deploying ANY member deploys the whole group (see src/linked.js).
/// </summary>
public sealed class LinkedGroup
{
    [JsonPropertyName("package")] public LinkedPackage Package { get; set; } = new();
    [JsonPropertyName("sites")]   public List<string> Sites    { get; set; } = new();
}

public sealed class LinkedPackage
{
    [JsonPropertyName("slug")]      public string Slug      { get; set; } = "";
    [JsonPropertyName("sourceDir")] public string SourceDir { get; set; } = "";
    [JsonPropertyName("repo")]      public string Repo      { get; set; } = "";
    [JsonPropertyName("branch")]    public string Branch    { get; set; } = "main";
    [JsonPropertyName("remote")]    public string Remote    { get; set; } = "origin";
    /// <summary>Folder inside the repo that jsDelivr serves as the package: gh/&lt;repo&gt;@V&lt;n&gt;/&lt;cdnSubpath&gt;/...</summary>
    [JsonPropertyName("cdnSubpath")] public string? CdnSubpath { get; set; }
    /// <summary>The first release tag when the repo has no whole-number tag yet (e.g. V12).</summary>
    [JsonPropertyName("firstTag")]  public string? FirstTag   { get; set; }
}

public sealed class SiteProfile
{
    [JsonPropertyName("slug")]          public string Slug          { get; set; } = "";
    [JsonPropertyName("sourceDir")]     public string SourceDir     { get; set; } = "";
    [JsonPropertyName("ftpRemotePath")] public string FtpRemotePath { get; set; } = "";
    [JsonPropertyName("files")]         public List<string> Files   { get; set; } = new();
    [JsonPropertyName("stampFile")]     public string? StampFile    { get; set; }
    /// <summary>Linked deploy: which pages load package assets (pinned + CDN-checked). Default: the stampFile.</summary>
    [JsonPropertyName("pinFiles")]      public List<string>? PinFiles { get; set; }
    [JsonPropertyName("preDeploy")]     public List<HookProfile> PreDeploy { get; set; } = new();
}
