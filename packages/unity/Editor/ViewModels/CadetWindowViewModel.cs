namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// Main window ViewModel - coordinates all child ViewModels and handles cross-ViewModel communication
    /// </summary>
    public class CadetWindowViewModel
    {
        public ProfileManagerViewModel ProfileManager { get; private set; }
        public ActionButtonsViewModel ActionButtons { get; private set; }
        public ProgressBarViewModel ProgressBar { get; private set; }
        public ConsoleOutputViewModel ConsoleOutput { get; private set; }
        
        public CadetWindowViewModel()
        {
            // Initialize ViewModels
            ProfileManager = new ProfileManagerViewModel();
            ActionButtons = new ActionButtonsViewModel();
            ProgressBar = new ProgressBarViewModel();
            ConsoleOutput = new ConsoleOutputViewModel();
            
            // Wire up cross-ViewModel communication
            ProfileManager.SelectedIndexChanged += (index) =>
            {
                ActionButtons.HasProfile = ProfileManager.HasProfile;
            };
            
            ProfileManager.SelectedProfileInfoChanged += (info) =>
            {
                // Update any dependent ViewModels if needed
            };
            
            // Clear the log file on startup for a fresh session
            // Note: All output now goes to Library/cadet_build.log - use "Monitor CADET Log" button to view
            ConsoleOutput.Clear();
            ConsoleOutput.AppendLine("CADET - Cross-platform Automated Deployment Engine & Tooling");
            ConsoleOutput.AppendLine("Ready. Select a profile and click an action button to begin.");
            ConsoleOutput.AppendLine($"Log file: {ConsoleOutput.LogFilePath}");
        }
    }
}

