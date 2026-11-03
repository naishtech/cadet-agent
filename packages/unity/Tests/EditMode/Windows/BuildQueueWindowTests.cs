using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Covyne.CADET.Editor.Lite.Windows;
using System;
using System.Reflection;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Tests.Windows
{
    /// <summary>
    /// Tests for the build history window UI component.
    /// Verifies history visualization, job management, and thread safety.
    /// </summary>
    public class BuildQueueWindowTests
    {
        private static void CloseWindow(EditorWindow window)
        {
            if (!Application.isEditor || Application.isPlaying)
            {
                return;
            }

            if (window != null)
            {
                // Close first so Unity updates window state, then destroy immediately.
                window.Close();
                EditorWindow.DestroyImmediate(window);
            }
        }

        private static void CloseAllBuildQueueWindows()
        {
            if (!Application.isEditor || Application.isPlaying)
            {
                return;
            }

            var windows = Resources.FindObjectsOfTypeAll<BuildQueueWindow>();
            foreach (var editorWindow in windows)
            {
                if (editorWindow != null)
                {
                    editorWindow.Close();
                    EditorWindow.DestroyImmediate(editorWindow);
                }
            }
        }

        private static void RunWithWindow(Action<BuildQueueWindow> action)
        {
            BuildQueueWindow window = null;
            try
            {
                CloseAllBuildQueueWindows();
                window = EditorWindow.GetWindow<BuildQueueWindow>();
                action(window);
            }
            finally
            {
                CloseWindow(window);
                CloseAllBuildQueueWindows();
            }
        }

        [Test]
        public void OpenWindow_CreatesWindowOfCorrectType()
        {
            RunWithWindow(testWindow =>
            {
                Assert.IsNotNull(testWindow);
                Assert.AreEqual("Build History", testWindow.titleContent.text);
            });
        }

        [Test]
        public void GetWindow_ReturnsExistingWindowIfAlreadyOpen()
        {
            RunWithWindow(testWindow =>
            {
                var firstWindow = testWindow;
                var secondWindow = EditorWindow.GetWindow<BuildQueueWindow>();
                Assert.AreEqual(firstWindow, secondWindow);
                CloseWindow(secondWindow);
            });
        }

        [Test]
        public void Window_MaintainsMinimumWidth()
        {
            RunWithWindow(testWindow =>
            {
                Assert.Greater(testWindow.minSize.x, 0);
                Assert.Greater(testWindow.minSize.y, 0);
            });
        }

        [Test]
        public void Window_CanBeClosedWithoutErrors()
        {
            RunWithWindow(testWindow =>
            {
                testWindow.Close();
                // No exceptions thrown, window closed successfully
            });
        }

        [Test]
        public void WindowTitle_IsConsistent()
        {
            RunWithWindow(testWindow =>
            {
                var title = testWindow.titleContent.text;
                Assert.AreEqual("Build History", title);
            });
        }

        [Test]
        public void Window_CanBeRefreshedMultipleTimes()
        {
            RunWithWindow(testWindow =>
            {
                for (int i = 0; i < 10; i++)
                {
                    testWindow.Repaint();
                }

                Assert.IsNotNull(testWindow);
            });
        }

        [Test]
        public void GetProfileNameForJob_WithProfileName_ReturnsProfileName()
        {
            RunWithWindow(testWindow =>
            {
                BuildJobDefinition job = new BuildJobDefinition("profile-guid")
                {
                    ProfileName = "My Profile"
                };

                MethodInfo method = typeof(BuildQueueWindow).GetMethod(
                    "GetProfileNameForJob",
                    BindingFlags.Instance | BindingFlags.NonPublic);

                Assert.IsNotNull(method, "GetProfileNameForJob should exist.");
                string result = (string)method.Invoke(testWindow, new object[] { job });

                Assert.AreEqual("My Profile", result);
            });
        }

        [Test]
        public void GetProfileNameForJob_WithMissingNames_FallsBackToProfileGuid()
        {
            RunWithWindow(testWindow =>
            {
                BuildJobDefinition job = new BuildJobDefinition("profile-guid-fallback")
                {
                    ProfileName = string.Empty,
                    JobGuid = Guid.NewGuid().ToString()
                };

                MethodInfo method = typeof(BuildQueueWindow).GetMethod(
                    "GetProfileNameForJob",
                    BindingFlags.Instance | BindingFlags.NonPublic);

                Assert.IsNotNull(method, "GetProfileNameForJob should exist.");
                string result = (string)method.Invoke(testWindow, new object[] { job });

                Assert.AreEqual("profile-guid-fallback", result,
                    "Profile label fallback should always show profile guid when profile name is unavailable.");
            });
        }

        [Test]
        public void GetProfileNameForJob_WithNoJob_ReturnsUnknownProfile()
        {
            RunWithWindow(testWindow =>
            {
                MethodInfo method = typeof(BuildQueueWindow).GetMethod(
                    "GetProfileNameForJob",
                    BindingFlags.Instance | BindingFlags.NonPublic);

                Assert.IsNotNull(method, "GetProfileNameForJob should exist.");
                string result = (string)method.Invoke(testWindow, new object[] { null });

                Assert.AreEqual("Unknown Profile", result,
                    "Profile label should never disappear; missing job should map to 'Unknown Profile'.");
            });
        }
    }
}
