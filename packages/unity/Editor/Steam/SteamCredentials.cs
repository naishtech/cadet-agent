using System;

namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// Data class for Steam credentials
    /// </summary>
    [Serializable]
    public class SteamCredentials
    {
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public string GuardCode { get; set; } = "";
        
        public bool IsEmpty()
        {
            return string.IsNullOrEmpty(Username) && 
                   string.IsNullOrEmpty(Password) && 
                   string.IsNullOrEmpty(GuardCode);
        }
        
        public bool HasBasicCredentials()
        {
            return !string.IsNullOrEmpty(Username) && !string.IsNullOrEmpty(Password);
        }
    }
}

