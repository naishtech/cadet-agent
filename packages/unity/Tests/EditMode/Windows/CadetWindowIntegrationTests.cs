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

#if CADET_LITE
        [Test]
        public void DirectorySyncConfirmation_GitSyncProfile_DoesNotShowDialog()
        {
            int dialogCalls = 0;
            SetDirectorySyncDialogForTests((title, message, ok, cancel) =>
            {
                dialogCalls++;
                return false;
            });

            try
            {
                bool result = InvokeDirectorySyncConfirmation(new BuildProfile { useGit = true });
                Assert.IsTrue(result);
                Assert.AreEqual(0, dialogCalls);
            }
            finally
            {
                ResetDirectorySyncDialogForTests();
            }
        }

        [Test]
        public void DirectorySyncConfirmation_DirectorySyncProfile_ReturnsDialogResult()
        {
            int dialogCalls = 0;
            SetDirectorySyncDialogForTests((title, message, ok, cancel) =>
            {
                dialogCalls++;
                return false;
            });

            try
            {
                bool result = InvokeDirectorySyncConfirmation(new BuildProfile { useGit = false });
                Assert.IsFalse(result);
                Assert.AreEqual(1, dialogCalls);
            }
            finally
            {
                ResetDirectorySyncDialogForTests();
            }
        }

        [Test]
        public void DirectorySyncConfirmation_NullProfile_AllowsExecution()
        {
            int dialogCalls = 0;
            SetDirectorySyncDialogForTests((title, message, ok, cancel) =>
            {
                dialogCalls++;
                return false;
            });

            try
            {
                bool result = InvokeDirectorySyncConfirmation(null);
                Assert.IsTrue(result);
                Assert.AreEqual(0, dialogCalls);
            }
            finally
            {
                ResetDirectorySyncDialogForTests();
            }
        }

        private static bool InvokeDirectorySyncConfirmation(BuildProfile profile)
        {
            MethodInfo method = typeof(CadetWindow).GetMethod(
                "ShowDirectorySyncConfirmation",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.IsNotNull(method);
            return (bool)method.Invoke(null, new object[] { profile });
        }

        private static void SetDirectorySyncDialogForTests(Func<string, string, string, string, bool> handler)
        {
            MethodInfo method = typeof(CadetWindow).GetMethod(
                "SetDirectorySyncConfirmationDialogForTests",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.IsNotNull(method);
            method.Invoke(null, new object[] { handler });
        }

        private static void ResetDirectorySyncDialogForTests()
        {
            MethodInfo method = typeof(CadetWindow).GetMethod(
                "ResetDirectorySyncConfirmationDialogForTests",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.IsNotNull(method);
            method.Invoke(null, null);
        }
#endif
    }
}
