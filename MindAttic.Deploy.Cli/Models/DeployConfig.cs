using System.Text.Json.Serialization;

namespace MindAttic.Deploy.Cli.Models;

public sealed class DeployConfig
{
    [JsonPropertyName("componentsVersion")] public string? ComponentsVersion { get; set; }
    [JsonPropertyName("ftpRemoteRoot")]     public string? FtpRemoteRoot    { get; set; }
    [JsonPropertyName("sites")]             public List<SiteProfile>     Sites    { get; set; } = new();
    [JsonPropertyName("apps")]              public List<AppProfile>      Apps     { get; set; } = new();
    [JsonPropertyName("projects")]          public List<CatalogProject>  Projects { get; set; } = new();
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

/// <summary>A single preDeploy hook entry (uiux-pull / powershell / dotnet-build).</summary>
public sealed class HookProfile
{
    [JsonPropertyName("kind")]          public string  Kind          { get; set; } = "";
    [JsonPropertyName("file")]          public string? File          { get; set; }
    [JsonPropertyName("project")]       public string? Project       { get; set; }
    [JsonPropertyName("configuration")] public string? Configuration { get; set; }
    [JsonPropertyName("args")]          public List<string> Args      { get; set; } = new();
    [JsonPropertyName("required")]      public bool?   Required      { get; set; }
}

public sealed class CatalogProject
{
    [JsonPropertyName("slug")]    public string Slug    { get; set; } = "";
    [JsonPropertyName("repo")]    public string Repo    { get; set; } = "";
    [JsonPropertyName("title")]   public string Title   { get; set; } = "";
    [JsonPropertyName("tagline")] public string Tagline { get; set; } = "";
    [JsonPropertyName("theme")]   public string? Theme  { get; set; }
}

public sealed class SiteProfile
{
    [JsonPropertyName("slug")]          public string Slug          { get; set; } = "";
    [JsonPropertyName("sourceDir")]     public string SourceDir     { get; set; } = "";
    [JsonPropertyName("ftpRemotePath")] public string FtpRemotePath { get; set; } = "";
    [JsonPropertyName("files")]         public List<string> Files   { get; set; } = new();
    [JsonPropertyName("stampFile")]     public string? StampFile    { get; set; }
    [JsonPropertyName("preDeploy")]     public List<HookProfile> PreDeploy { get; set; } = new();
}
