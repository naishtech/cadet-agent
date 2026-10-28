using UnityEngine;

namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// ScriptableObject wrapper for BuildProfile - enables Unity asset persistence
    /// </summary>
    [CreateAssetMenu(fileName = "NewProfile", menuName = "CADET/Build Profile", order = 1)]
    public class BuildProfileAsset : ScriptableObject
    {
        [SerializeField]
        private BuildProfile profile;
        
        /// <summary>
        /// The build profile data
        /// </summary>
        public BuildProfile Profile
        {
            get
            {
                if (profile == null)
                {
                    profile = new BuildProfile();
                }
                return profile;
            }
            set
            {
                profile = value;
            }
        }
        
        /// <summary>
        /// Creates a new BuildProfileAsset instance (for programmatic creation)
        /// </summary>
        public static BuildProfileAsset CreateInstance(BuildProfile profileData)
        {
            var asset = CreateInstance<BuildProfileAsset>();
            asset.profile = profileData ?? new BuildProfile();
            return asset;
        }
        
        /// <summary>
        /// Validates that the profile name is set and matches the asset name
        /// </summary>
        public void ValidateProfileName()
        {
            if (profile != null && !string.IsNullOrEmpty(name))
            {
                // Ensure profile name matches asset name (without .asset extension)
                string assetName = name;
                if (profile.profileName != assetName)
                {
                    profile.profileName = assetName;
                }
            }
        }
        
        private void OnValidate()
        {
            // Ensure profile name stays in sync with asset name
            ValidateProfileName();
        }
    }
}

