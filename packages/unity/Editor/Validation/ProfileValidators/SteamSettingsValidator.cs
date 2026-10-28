using System.Collections.Generic;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Validation.Validators;

namespace Covyne.CADET.Editor.Validation.ProfileValidators
{
    /// <summary>
    /// Validators for Steam settings fields
    /// </summary>
    public static class SteamSettingsValidator
    {
        public static List<IValidator> GetAppIdValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Steam App ID is required."),
                new NumericValidator(allowNegative: false, customErrorMessage: "Steam App ID must be a positive number.")
            };
        }
        
        public static bool ShouldValidate(BuildProfile profile)
        {
#if CADET_LITE
            return false;
#else
            return profile != null && (profile.platform == "steam" || profile.platform == "both");
#endif
        }
    }
}

