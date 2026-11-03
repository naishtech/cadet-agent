using System;

namespace Covyne.CADET.Editor.Epic
{
    /// <summary>
    /// Data class for Epic Games Store credentials
    /// </summary>
    [Serializable]
    public class EpicCredentials
    {
        public string ClientId { get; set; } = "";
        public string ClientSecret { get; set; } = "";
        
        public bool IsEmpty()
        {
            return string.IsNullOrEmpty(ClientId) && 
                   string.IsNullOrEmpty(ClientSecret);
        }
        
        public bool HasBasicCredentials()
        {
            return !string.IsNullOrEmpty(ClientId) && !string.IsNullOrEmpty(ClientSecret);
        }
    }
}

