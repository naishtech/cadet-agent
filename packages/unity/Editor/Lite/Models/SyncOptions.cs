using System;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class SyncOptions
    {
        public string[] ExcludePatterns;
        public bool DeleteExtraneousFiles;
        public bool VerifyContentWhenMetadataMatches;

        public static SyncOptions Default()
        {
            return new SyncOptions
            {
                ExcludePatterns = Array.Empty<string>(),
                DeleteExtraneousFiles = false,
                VerifyContentWhenMetadataMatches = false
            };
        }
    }
}
