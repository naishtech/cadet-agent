using System.Collections.Generic;
using System.IO;
using System.Text;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Utilities
{
    /// <summary>
    /// The plugin root is known in one place, CadetLitePathService. This test fails when
    /// editor code hardcodes it again, so a different install root stays one edit.
    /// </summary>
    [TestFixture]
    public class PluginRootLiteralTests
    {
        private const string PathServiceFileName = "CadetLitePathService.cs";

        [Test]
        public void PathService_ExposesTheRootAndTheCliRoot()
        {
            Assert.AreEqual("Assets/Covyne/Cadet", CadetLitePathService.PluginRoot);
            Assert.AreEqual("Assets/Covyne/Cadet/CLI", CadetLitePathService.CliRoot);
        }

        [Test]
        public void GetCliPath_JoinsUnderTheProjectRoot()
        {
            string projectRoot = Path.Combine(Path.GetTempPath(), "cadet-plugin-root-test");

            string distScript = CadetLitePathService.GetCliPath(projectRoot, "dist.sh");
            string cliRoot = CadetLitePathService.GetCliPath(projectRoot);

            Assert.AreEqual(Path.Combine(projectRoot, "Assets", "Covyne", "Cadet", "CLI", "dist.sh"), distScript);
            Assert.AreEqual(Path.Combine(projectRoot, "Assets", "Covyne", "Cadet", "CLI"), cliRoot);
        }

        [Test]
        public void GetPluginPath_JoinsUnderTheProjectRoot()
        {
            string projectRoot = Path.Combine(Path.GetTempPath(), "cadet-plugin-root-test");

            string csv = CadetLitePathService.GetPluginPath(projectRoot, "Editor", "Localization", "CADET_Localization_en.csv");

            Assert.AreEqual(
                Path.Combine(projectRoot, "Assets", "Covyne", "Cadet", "Editor", "Localization", "CADET_Localization_en.csv"),
                csv);
        }

        [Test]
        public void GetPluginPath_WithoutAProjectRoot_Throws()
        {
            Assert.Throws<System.ArgumentNullException>(() => CadetLitePathService.GetPluginPath(null, "Editor"));
            Assert.Throws<System.ArgumentNullException>(() => CadetLitePathService.GetCliPath("  ", "dist.sh"));
        }

        [Test]
        public void EditorSources_DoNotHardcodeThePluginRoot()
        {
            string projectRoot = Path.GetDirectoryName(Path.GetFullPath(Application.dataPath));
            string editorRoot = Path.Combine(
                projectRoot,
                CadetLitePathService.PluginRoot.Replace('/', Path.DirectorySeparatorChar),
                "Editor");

            Assert.IsTrue(Directory.Exists(editorRoot), "Editor sources are not at " + editorRoot);

            List<string> offenders = new List<string>();
            int scanned = 0;

            foreach (string file in Directory.GetFiles(editorRoot, "*.cs", SearchOption.AllDirectories))
            {
                if (Path.GetFileName(file) == PathServiceFileName)
                {
                    continue;
                }

                scanned++;
                string[] lines = File.ReadAllLines(file);
                for (int i = 0; i < lines.Length; i++)
                {
                    if (HardcodesTheRoot(lines[i]))
                    {
                        offenders.Add(Path.GetFileName(file) + ":" + (i + 1) + " -> " + lines[i].Trim());
                    }
                }
            }

            Assert.Greater(scanned, 0, "No editor sources were scanned under " + editorRoot);
            Assert.IsEmpty(
                offenders,
                "Editor code hardcodes the plugin root. Ask CadetLitePathService instead:" + Format(offenders));
        }

        private static bool HardcodesTheRoot(string line)
        {
            if (line.Contains("\"Assets/Covyne/Cadet"))
            {
                return true;
            }

            // The split form, Path.Combine(root, "Assets", "Covyne", "Cadet"), with any spacing.
            StringBuilder compact = new StringBuilder(line.Length);
            foreach (char c in line)
            {
                if (!char.IsWhiteSpace(c))
                {
                    compact.Append(c);
                }
            }

            return compact.ToString().Contains("\"Assets\",\"Covyne\",\"Cadet\"");
        }

        private static string Format(List<string> offenders)
        {
            StringBuilder message = new StringBuilder();
            foreach (string offender in offenders)
            {
                message.Append('\n').Append("  ").Append(offender);
            }

            // NUnit formats its message argument, and an offending line can contain braces.
            return message.ToString().Replace("{", "{{").Replace("}", "}}");
        }
    }
}
