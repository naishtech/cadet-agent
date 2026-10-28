using System;
using System.Collections.Generic;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class WorkspaceRegistry
    {
        public List<WorkspaceInfo> Workspaces = new List<WorkspaceInfo>();

        public string ToJson()
        {
            return JsonUtility.ToJson(this, true);
        }

        public static WorkspaceRegistry FromJson(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                throw new ArgumentException("JSON string cannot be null or empty", nameof(json));
            }

            return JsonUtility.FromJson<WorkspaceRegistry>(json);
        }
    }
}
