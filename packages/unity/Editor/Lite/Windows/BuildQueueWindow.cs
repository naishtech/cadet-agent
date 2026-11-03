using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.Lite.Windows
{
    /// <summary>
    /// Build-history host window.
    /// The legacy queue-oriented type name is retained to avoid widening compatibility churn.
    /// </summary>
    public class BuildQueueWindow : EditorWindow
    {
        private BuildQueuePanel historyPanel;

        public static void ShowWindow()
        {
            BuildQueueWindow window = GetWindow<BuildQueueWindow>("Build History");
            window.minSize = new Vector2(600, 400);
            window.Show();
        }

        private void OnEnable()
        {
            GetOrCreateHistoryPanel().Initialize();
            titleContent = new GUIContent("Build History");
        }

        private void OnDisable()
        {
            historyPanel?.Dispose();
            historyPanel = null;
        }

        private void OnGUI()
        {
            GetOrCreateHistoryPanel().DrawWindowContents();
        }

        public void RefreshFromBackgroundThread()
        {
            GetOrCreateHistoryPanel().RefreshFromBackgroundThread();
        }

        private BuildQueuePanel GetOrCreateHistoryPanel()
        {
            if (historyPanel == null)
            {
                historyPanel = new BuildQueuePanel(Repaint);
            }

            return historyPanel;
        }

        private string GetProfileNameForJob(BuildJobDefinition job)
        {
            return GetOrCreateHistoryPanel().GetProfileNameForJob(job);
        }
    }
}
