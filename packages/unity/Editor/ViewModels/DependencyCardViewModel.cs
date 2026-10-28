using System;
using Covyne.CADET.Editor.PublishingTools;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// ViewModel for dependency card - manages dependency state and commands
    /// </summary>
    public class DependencyCardViewModel
    {
        private DependencyStatus status;
        private string licenseUrl;
        private string downloadUrl;
        
        public DependencyStatus Status
        {
            get => status;
            private set
            {
                if (status != value)
                {
                    status = value;
                    StatusChanged?.Invoke(value);
                }
            }
        }
        
        public string LicenseUrl => licenseUrl;
        public string DownloadUrl => downloadUrl;
        
        // Events
        public event Action<DependencyStatus> StatusChanged;
        public event Action OnDownloadRequested;
        public event Action OnVerifyRequested;
        public event Action OnUninstallRequested;
        
        public DependencyCardViewModel(DependencyStatus status, string licenseUrl, string downloadUrl)
        {
            this.status = status;
            this.licenseUrl = licenseUrl;
            this.downloadUrl = downloadUrl;
        }
        
        public void UpdateStatus(DependencyStatus newStatus)
        {
            Status = newStatus;
        }
        
        public void RequestDownload()
        {
            OnDownloadRequested?.Invoke();
        }
        
        public void RequestVerify()
        {
            OnVerifyRequested?.Invoke();
        }
        
        public void RequestUninstall()
        {
            OnUninstallRequested?.Invoke();
        }
    }
}

