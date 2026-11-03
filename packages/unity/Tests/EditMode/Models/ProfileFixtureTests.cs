using System.Collections.Generic;
using System.IO;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Models
{
    /// <summary>
    /// The profile fixtures in packages/cli/fixtures/profiles are shared test data: the CLI
    /// validates them and this assembly must read the same files. These tests fail when a
    /// fixture stops satisfying the contract the CLI enforces (Util/json_parser.sh), or when
    /// the model silently drops a field the fixture carries.
    /// </summary>
    [TestFixture]
    public class ProfileFixtureTests
    {
        private static readonly string[] ValidPlatforms = { "none", "steam", "epic", "both" };
        private static readonly string[] ValidOperatingSystems = { "windows", "mac", "both" };

        [Test]
        public void ValidFixtures_LoadAndSatisfyTheProfileContract()
        {
            List<string> files = ValidFixtureFiles();
            Assert.AreEqual(4, files.Count, "The shared fixture set changed size: " + Join(files));

            foreach (string file in files)
            {
                BuildProfile profile = Load(file);

                Assert.AreEqual(Path.GetFileNameWithoutExtension(file), profile.profileName,
                    file + ": profileName does not match the file name.");
                CollectionAssert.Contains(ValidPlatforms, profile.platform, file + ": invalid platform.");
                CollectionAssert.Contains(ValidOperatingSystems, profile.os, file + ": invalid os.");
                Assert.IsNotEmpty(profile.bundleId, file + ": bundleId is required by the schema.");

                if (Path.GetFileName(file).StartsWith("unity"))
                {
                    Assert.IsNotNull(profile.unity, file + ": unity section did not load.");
                    Assert.IsNotEmpty(profile.unity.editorPath, file + ": unity.editorPath is required.");
                    Assert.IsNotEmpty(profile.unity.projectPath, file + ": unity.projectPath is required.");
                }

                if (profile.platform == "steam" || profile.platform == "both")
                {
                    Assert.IsNotEmpty(profile.steam.appId,
                        file + ": steam.appId is required when the platform publishes to Steam.");
                }

                if (profile.platform == "epic" || profile.platform == "both")
                {
                    Assert.IsNotEmpty(profile.epic.productId, file + ": epic.productId is required.");
                }
            }
        }

        [Test]
        public void ValidFixtures_SurviveAJsonRoundTrip()
        {
            List<string> files = ValidFixtureFiles();
            Assert.IsNotEmpty(files);

            foreach (string file in files)
            {
                BuildProfile original = Load(file);
                string written = JsonUtility.ToJson(original, true);
                BuildProfile reread = JsonUtility.FromJson<BuildProfile>(written);

                Assert.AreEqual(original.profileName, reread.profileName, file + ": profileName");
                Assert.AreEqual(original.platform, reread.platform, file + ": platform");
                Assert.AreEqual(original.os, reread.os, file + ": os");
                Assert.AreEqual(original.bundleId, reread.bundleId, file + ": bundleId");
                Assert.AreEqual(original.unity.projectPath, reread.unity.projectPath, file + ": unity.projectPath");
                Assert.AreEqual(original.steam.appId, reread.steam.appId, file + ": steam.appId");
                Assert.AreEqual(original.epic.productId, reread.epic.productId, file + ": epic.productId");
                Assert.AreEqual(original.macos.enableSigning, reread.macos.enableSigning, file + ": macos.enableSigning");
            }
        }

        private static BuildProfile Load(string file)
        {
            string text = File.ReadAllText(file);
            BuildProfile profile = JsonUtility.FromJson<BuildProfile>(text);
            Assert.IsNotNull(profile, file + ": JsonUtility returned null.");
            return profile;
        }

        private static List<string> ValidFixtureFiles()
        {
            string directory = FixturesDirectory();
            if (!Directory.Exists(directory))
            {
                Assert.Ignore("No CLI fixtures at " + directory +
                    ". Install the Unity CLI component, or copy packages/cli/fixtures into it.");
            }

            List<string> files = new List<string>();
            foreach (string file in Directory.GetFiles(directory, "*.json"))
            {
                if (!Path.GetFileName(file).StartsWith("invalid-"))
                {
                    files.Add(file);
                }
            }

            files.Sort();
            return files;
        }

        private static string FixturesDirectory()
        {
            string projectRoot = Path.GetDirectoryName(Path.GetFullPath(Application.dataPath));
            return CadetLitePathService.GetCliPath(projectRoot, "fixtures", "profiles");
        }

        private static string Join(List<string> files)
        {
            List<string> names = new List<string>();
            foreach (string file in files)
            {
                names.Add(Path.GetFileName(file));
            }

            return string.Join(", ", names.ToArray());
        }
    }
}
