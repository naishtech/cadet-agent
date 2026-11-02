using System;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Tests.Windows
{
    /// <summary>
    /// Integration tests for CadetWindow lifecycle and stability.
    /// These tests are foundation coverage before queue-button integration work.
    /// </summary>
    public class CadetWindowIntegrationTests
    {
        private static void CloseWindow(EditorWindow window)
        {
            if (!Application.isEditor || Application.isPlaying)
            {
                return;
            }

            if (window != null)
            {
                window.Close();
                EditorWindow.DestroyImmediate(window);
            }
        }

        private static void CloseAllCadetWindows()
        {
            if (!Application.isEditor || Application.isPlaying)
            {
                return;
            }

            var windows = Resources.FindObjectsOfTypeAll<CadetWindow>();
            foreach (var editorWindow in windows)
            {
                if (editorWindow != null)
                {
                    editorWindow.Close();
                    EditorWindow.DestroyImmediate(editorWindow);
                }
            }
        }

        private static void RunWithCadetWindow(Action<CadetWindow> action)
        {
            CadetWindow window = null;
            try
            {
                CloseAllCadetWindows();
                window = EditorWindow.GetWindow<CadetWindow>();
                action(window);
            }
            finally
            {
                CloseWindow(window);
                CloseAllCadetWindows();
            }
        }

        [Test]
        public void OpenWindow_CreatesCadetWindow()
        {
            RunWithCadetWindow(window =>
            {
                Assert.IsNotNull(window);
            });
        }

        [Test]
        public void Window_Repaint_DoesNotThrow()
        {
            RunWithCadetWindow(window =>
            {
                Assert.DoesNotThrow(() => window.Repaint());
            });
        }

        [Test]
        public void Window_Close_DoesNotThrow()
        {
            RunWithCadetWindow(window =>
            {
                Assert.DoesNotThrow(() => window.Close());
            });
        }

    }
}
