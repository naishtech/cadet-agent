using System;
using System.Collections.Generic;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class SyncManifest
    {
        public List<SyncManifestEntry> Entries = new List<SyncManifestEntry>();

        public string ToJson()
        {
            return JsonUtility.ToJson(this, true);
        }

        public static SyncManifest FromJson(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                throw new ArgumentException("JSON string cannot be null or empty", nameof(json));
            }

            return JsonUtility.FromJson<SyncManifest>(json);
        }
    }

    [Serializable]
    public class SyncManifestEntry
    {
        public string RelativePath;
        public long FileSize;

        [SerializeField] private string _lastWriteUtcString;

        public DateTime LastWriteUtc
        {
            get => string.IsNullOrEmpty(_lastWriteUtcString)
                ? DateTime.MinValue
                : DateTime.Parse(_lastWriteUtcString, null, System.Globalization.DateTimeStyles.RoundtripKind);
            set => _lastWriteUtcString = value.ToString("O");
        }
    }
}
