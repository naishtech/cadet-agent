using System;
using Covyne.CADET.Editor.Models;
using UnityEditor;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Dispatches live output updates onto the editor thread.
    /// </summary>
    public static class BuildOperationLiveOutputService
    {
        public static void Enqueue(
            string line,
            CadetConsoleMessageType type,
            Action<string, CadetConsoleMessageType> appendLine,
            Action repaint,
            Action<Action> scheduleOnEditorThread = null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                return;
            }

            string normalizedLine = line.TrimEnd();
            Action flush = () =>
            {
                appendLine?.Invoke(normalizedLine, type);
                repaint?.Invoke();
            };

            if (scheduleOnEditorThread != null)
            {
                scheduleOnEditorThread(flush);
                return;
            }

            // Delay-call scheduling avoids mutating GUI-bound state from background worker threads.
            EditorApplication.delayCall += () => flush();
        }
    }
}
