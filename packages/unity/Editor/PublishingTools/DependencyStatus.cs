using System;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.PublishingTools
{
    /// <summary>
    /// Represents the installation status of a dependency
    /// </summary>
    public enum DependencyState
    {
        Missing,
        Downloading,
        Extracting,
        Installed,
        Error
    }

    /// <summary>
    /// Data class representing a dependency's current status
    /// </summary>
    [Serializable]
    public class DependencyStatus
    {
        public string name;
        public string description;
        public string installPath;
        public DependencyState state;
        public string statusMessage;
        public float downloadProgress;
        public long bytesDownloaded; // Track bytes downloaded for progress display
        public long totalBytes; // Total bytes to download
        public string version;
        public string errorMessage;
        public bool licenseAccepted;
        public string customPath; // User-specified custom path (if not using default location)
        
        public DependencyStatus(string name, string description, string installPath)
        {
            this.name = name;
            this.description = description;
            this.installPath = installPath;
            this.state = DependencyState.Missing;
            this.statusMessage = CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.NotInstalled");
            this.downloadProgress = 0f;
            this.bytesDownloaded = 0;
            this.totalBytes = 0;
            this.version = "";
            this.errorMessage = "";
            this.licenseAccepted = false;
            this.customPath = "";
        }

        public string GetStatusIcon()
        {
            return state switch
            {
                DependencyState.Missing => "⚠️",
                DependencyState.Downloading or DependencyState.Extracting => "⏳",
                DependencyState.Installed => "✅",
                DependencyState.Error => "❌",
                _ => "?",
            };

        }

        public string GetStatusText()
        {
            return state switch
            {
                DependencyState.Missing => CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.Missing"),
                DependencyState.Downloading => GetDownloadProgressText(),
                DependencyState.Extracting => CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.Extracting"),
                DependencyState.Installed => CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.Installed"),
                DependencyState.Error => CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.Error"),
                _ => CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.Unknown"),
            };

        }
        
        private string GetDownloadProgressText()
        {
            string downloadingText = CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Status.Downloading");
            string progressText = "";
            
            if (bytesDownloaded > 0)
            {
                // Format downloaded bytes
                string downloadedStr = FormatBytes(bytesDownloaded);
                
                // Format total bytes if available
                if (totalBytes > 0)
                {
                    string totalStr = FormatBytes(totalBytes);
                    string downloadedOfTotal = CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Progress.DownloadedOfTotal");
                    progressText = string.Format(downloadedOfTotal, downloadedStr, totalStr) + " ";
                }
                else
                {
                    progressText = downloadedStr + " ";
                }
            }
            
            string percentText = CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Progress.Percent");
            string percent = string.Format(percentText, (int)(downloadProgress * 100));
            
            return $"{downloadingText} {progressText}{percent}";
        }
        
        private string FormatBytes(long bytes)
        {
            double kilobytes = bytes / 1024.0;
            if (kilobytes < 1024)
            {
                return $"{kilobytes:F1} KB";
            }
            else
            {
                double megabytes = kilobytes / 1024.0;
                if (megabytes < 1024)
                {
                    return $"{megabytes:F2} MB";
                }
                else
                {
                    double gigabytes = megabytes / 1024.0;
                    return $"{gigabytes:F2} GB";
                }
            }
        }
    }
}

