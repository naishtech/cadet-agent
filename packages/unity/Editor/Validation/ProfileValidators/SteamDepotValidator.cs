using System.Collections.Generic;
using Covyne.CADET.Editor.Validation.Validators;

namespace Covyne.CADET.Editor.Validation.ProfileValidators
{
    /// <summary>
    /// Validators for Steam depot fields
    /// </summary>
    public static class SteamDepotValidator
    {
        public static List<IValidator> GetDepotIdValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Depot ID is required."),
                new NumericValidator(allowNegative: false, customErrorMessage: "Depot ID must be a positive number.")
            };
        }
        
        public static List<IValidator> GetLocalPathValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Local Path is required."),
                new RegexValidator(@"^(windows|macos)\\\*$", "Local Path must match pattern: windows\\* or macos\\*")
            };
        }
        
        public static List<IValidator> GetDepotPathValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Depot Path is required.")
            };
        }
        
        public static List<IValidator> GetRecursiveValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Recursive is required."),
                new RegexValidator(@"^[01]$", "Recursive must be '0' or '1'.")
            };
        }
    }
}

