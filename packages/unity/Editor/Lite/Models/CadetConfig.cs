using System;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class CadetConfig
    {
        /// <summary>
        /// Absolute path to the directory that holds workspaces.json and workspace subdirectories.
        /// Defaults to ~/CADET/Workspaces when absent or empty.
        /// </summary>
        public string WorkspacesRoot;

        /// <summary>
        /// Absolute path to the directory that holds stable profile JSON snapshots.
        /// Defaults to ~/CADET/Profiles when absent or empty.
        /// </summary>
        public string ProfilesRoot;
    }
}
