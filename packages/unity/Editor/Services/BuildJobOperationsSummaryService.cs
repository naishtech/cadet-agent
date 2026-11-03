using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Services
{
    public static class BuildJobOperationsSummaryService
    {
        public static string GetSummary(BuildJobDefinition job)
        {
            List<string> operations = new List<string>();
            if (job.RunUnityBuild) operations.Add("Unity Build");
            if (job.RunNotarizeMac) operations.Add("Notarize macOS");
            if (job.RunPublishSteam) operations.Add("Publish Steam");
            if (job.RunPublishEpic) operations.Add("Publish Epic");
            return operations.Count == 0 ? "None" : string.Join(", ", operations);
        }
    }
}