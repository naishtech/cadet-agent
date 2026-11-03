using System;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// Coordinates cross-ViewModel invalidation for profile and configuration changes.
    /// Keeps orchestration logic out of the window shell.
    /// </summary>
    public class CadetWindowCoordinator
    {
        private readonly Action _updateBuildExistenceState;
        private readonly Action _updatePlatformAvailability;
        private readonly Action _updateCosmosBinariesAvailability;
        private readonly Action _checkProfileDependencies;
        private readonly Action _repaint;

        public CadetWindowCoordinator(
            Action updateBuildExistenceState,
            Action updatePlatformAvailability,
            Action updateCosmosBinariesAvailability,
            Action checkProfileDependencies,
            Action repaint)
        {
            _updateBuildExistenceState = updateBuildExistenceState ?? throw new ArgumentNullException(nameof(updateBuildExistenceState));
            _updatePlatformAvailability = updatePlatformAvailability ?? throw new ArgumentNullException(nameof(updatePlatformAvailability));
            _updateCosmosBinariesAvailability = updateCosmosBinariesAvailability ?? throw new ArgumentNullException(nameof(updateCosmosBinariesAvailability));
            _checkProfileDependencies = checkProfileDependencies ?? throw new ArgumentNullException(nameof(checkProfileDependencies));
            _repaint = repaint ?? throw new ArgumentNullException(nameof(repaint));
        }

        public void OnProfileSelected(string profileName, Action<string> logSelectedProfile)
        {
            logSelectedProfile?.Invoke(profileName);
            OnProfileConfigurationChanged();
        }

        public void OnProfileConfigurationChanged()
        {
            _updateBuildExistenceState();
            _updatePlatformAvailability();
            _updateCosmosBinariesAvailability();
            _checkProfileDependencies();
            _repaint();
        }

        public void OnMacCredentialsStateChanged()
        {
            _updateBuildExistenceState();
            _repaint();
        }
    }
}
