using System;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class SyncResult
    {
        public bool Success;
        public bool Cancelled;
        public int FilesCopied;
        public int FilesDeleted;
        public string ErrorMessage;
    }
}
