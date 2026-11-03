using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Utilities
{
    [TestFixture]
    public class CosmosBashMinimalIntegrationTests
    {
        [TearDown]
        public void TearDown()
        {
            CadetDebugPreferences.SetShowDetachedBashWindow(false);
        }

        [Test]
        [Explicit]
        [Category("Manual")]
        public void MinimalPowerShellPattern_RunsBuildHelp_AndEmitsUsageText()
        {
            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                Assert.Ignore("Windows-only integration test.");
            }

            string cosmosBin = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "CADET",
                "Tools",
                "cosmos-4.0.2~",
                "bin");
            string bashPath = Path.Combine(cosmosBin, "bash");
            if (!File.Exists(bashPath))
            {
                Assert.Ignore($"Cosmos bash not found at: {bashPath}");
            }

            string projectRoot = Path.GetDirectoryName(Application.dataPath);
            string buildShPath = Path.Combine(projectRoot, "Assets", "Covyne", "Cadet", "CLI", "build.sh");
            Assert.That(File.Exists(buildShPath), Is.True, $"build.sh not found at: {buildShPath}");

            string encodedCommand = BuildMinimalPowerShellEncodedCommand(cosmosBin, bashPath, buildShPath);
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -EncodedCommand {encodedCommand}",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = projectRoot
            };

            using var process = Process.Start(psi);
            Assert.That(process, Is.Not.Null, "Failed to start PowerShell integration process.");

            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            bool exited = process.WaitForExit(30000);

            Assert.That(exited, Is.True, "Timed out waiting for build.sh --help to finish.");
            Assert.That(process.ExitCode, Is.EqualTo(0), $"stderr:{Environment.NewLine}{error}{Environment.NewLine}stdout:{Environment.NewLine}{output}");

            string combined = output + Environment.NewLine + error;
            StringAssert.Contains("Usage:", combined, combined);
            StringAssert.Contains("--profile-json", combined, combined);
        }

        [Test]
        [Explicit]
        [Category("Manual")]
        public void MinimalPowerShellPattern_StartsVisibleCosmosBuildHelpWindow()
        {
            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                Assert.Ignore("Windows-only integration test.");
            }

            string cosmosBin = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "CADET",
                "Tools",
                "cosmos-4.0.2~",
                "bin");
            string bashPath = Path.Combine(cosmosBin, "bash");
            if (!File.Exists(bashPath))
            {
                Assert.Ignore($"Cosmos bash not found at: {bashPath}");
            }

            string projectRoot = Path.GetDirectoryName(Application.dataPath);
            string buildShPath = Path.Combine(projectRoot, "Assets", "Covyne", "Cadet", "CLI", "build.sh");
            Assert.That(File.Exists(buildShPath), Is.True, $"build.sh not found at: {buildShPath}");

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = BuildCmdKeepOpenPowerShellArguments(BuildMinimalPowerShellCommand(cosmosBin, bashPath, buildShPath)),
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal,
                WorkingDirectory = projectRoot
            };

            using Process launched = Process.Start(psi);
            Assert.That(launched, Is.Not.Null, "Failed to launch visible cosmos build help window.");
            int processId = launched.Id;

            Process process = null;
            try
            {
                process = Process.GetProcessById(processId);

                Thread.Sleep(1000);
                process.Refresh();
                Assert.That(process.HasExited, Is.False, "Expected the visible cosmos build help window to remain open for manual inspection.");

                IntPtr windowHandle = IntPtr.Zero;
                for (int attempt = 0; attempt < 20; attempt++)
                {
                    Thread.Sleep(250);
                    process.Refresh();
                    windowHandle = FindVisibleTopLevelWindow(processId);
                    if (windowHandle != IntPtr.Zero)
                    {
                        break;
                    }
                }

                Assert.That(windowHandle, Is.Not.EqualTo(IntPtr.Zero), "Expected a visible cmd-hosted PowerShell window for the cosmos build help path.");
            }
            finally
            {
                try
                {
                    process?.Kill();
                }
                catch
                {
                    // Best-effort cleanup for manual test.
                }
            }
        }

        [Test]
        [Explicit]
        [Category("Manual")]
        public void HelloPowerShellWindow_StaysOpen()
        {
            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                Assert.Ignore("Windows-only integration test.");
            }

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = BuildCmdKeepOpenPowerShellArguments("Write-Host 'HELLO_FROM_TEST'; Read-Host '[TEST] Press Enter to close this window'"),
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal,
                WorkingDirectory = Path.GetDirectoryName(Application.dataPath)
            };

            using Process launched = Process.Start(psi);
            Assert.That(launched, Is.Not.Null, "Failed to launch cmd-hosted PowerShell hello window.");
            int processId = launched.Id;

            Process process = null;
            try
            {
                process = Process.GetProcessById(processId);

                Thread.Sleep(1000);
                process.Refresh();
                Assert.That(process.HasExited, Is.False, "Expected the hello PowerShell window to remain open for manual inspection.");

                IntPtr windowHandle = IntPtr.Zero;
                for (int attempt = 0; attempt < 20; attempt++)
                {
                    Thread.Sleep(250);
                    process.Refresh();
                    windowHandle = FindVisibleTopLevelWindow(processId);
                    if (windowHandle != IntPtr.Zero)
                    {
                        break;
                    }
                }

                Assert.That(windowHandle, Is.Not.EqualTo(IntPtr.Zero), "Expected a visible cmd-hosted PowerShell hello window.");
            }
            finally
            {
                try
                {
                    process?.Kill();
                }
                catch
                {
                    // Best-effort cleanup for manual test.
                }
            }
        }

        [Test]
        [Explicit]
        [Category("Manual")]
        public void MinimalScriptViaPowerShellExe_StartsVisiblePowerShellWindow()
        {
            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                Assert.Ignore("Windows-only integration test.");
            }

            string cosmosBin = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "CADET",
                "Tools",
                "cosmos-4.0.2~",
                "bin");
            string bashPath = Path.Combine(cosmosBin, "bash");
            if (!File.Exists(bashPath))
            {
                Assert.Ignore($"Cosmos bash not found at: {bashPath}");
            }

            string projectRoot = Path.GetDirectoryName(Application.dataPath);
            string minimalScriptPath = Path.Combine(projectRoot, "Assets", "Tests", "cosmos-bash-build-help-minimal.ps1");
            Assert.That(File.Exists(minimalScriptPath), Is.True, $"minimal script not found at: {minimalScriptPath}");

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = BuildCmdKeepOpenPowerShellFileArguments(minimalScriptPath),
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal,
                WorkingDirectory = Path.GetDirectoryName(minimalScriptPath)
            };

            using Process launched = Process.Start(psi);
            Assert.That(launched, Is.Not.Null, "Failed to launch minimal PowerShell script via cmd-hosted PowerShell.");
            int processId = launched.Id;

            Process process = null;
            try
            {
                process = Process.GetProcessById(processId);

                Thread.Sleep(1000);
                process.Refresh();
                Assert.That(process.HasExited, Is.False, "Expected the visible PowerShell window to remain open for manual inspection.");

                IntPtr windowHandle = IntPtr.Zero;
                for (int attempt = 0; attempt < 20; attempt++)
                {
                    Thread.Sleep(250);
                    process.Refresh();
                    windowHandle = FindVisibleTopLevelWindow(processId);
                    if (windowHandle != IntPtr.Zero)
                    {
                        break;
                    }
                }

                Assert.That(windowHandle, Is.Not.EqualTo(IntPtr.Zero), "Expected a visible cmd-hosted PowerShell window for the minimal script.");
            }
            finally
            {
                try
                {
                    process?.Kill();
                }
                catch
                {
                    // Best-effort cleanup for manual test.
                }
            }
        }

        private static string BuildMinimalPowerShellCommand(string cosmosBin, string bashPath, string buildShPath)
        {
            string escapedCosmosBin = cosmosBin.Replace("'", "''");
            string escapedBashPath = bashPath.Replace("'", "''");
            string escapedBuildShPath = buildShPath.Replace("'", "''");

            return string.Join("; ", new[]
            {
                $"$env:PATH = '{escapedCosmosBin};' + $env:PATH",
                $"$env:COSMOS_BIN_DIR = '{escapedCosmosBin}'",
                $"$p = Start-Process -FilePath '{escapedBashPath}' -ArgumentList '{escapedBuildShPath}', '--help' -NoNewWindow -PassThru -Wait",
                "exit $p.ExitCode"
            });
        }

        private static string BuildMinimalPowerShellEncodedCommand(string cosmosBin, string bashPath, string buildShPath)
        {
            string command = BuildMinimalPowerShellCommand(cosmosBin, bashPath, buildShPath);
            return Convert.ToBase64String(Encoding.Unicode.GetBytes(command));
        }

        private static string BuildKeepOpenPowerShellCommand(string scriptPath)
        {
            string escapedScriptPath = scriptPath.Replace("'", "''");
            return string.Join("; ", new[]
            {
                $"& '{escapedScriptPath}'",
                "Write-Host ''",
                "Read-Host '[TEST] Press Enter to close this window'"
            });
        }

        private static string BuildCmdKeepOpenPowerShellArguments(string powerShellCommand)
        {
            string escapedPowerShellCommand = powerShellCommand.Replace("\"", "\"\"");
            return $"/k powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command \"{escapedPowerShellCommand}\"";
        }

        private static string BuildCmdKeepOpenPowerShellFileArguments(string scriptPath)
        {
            string escapedScriptPath = scriptPath.Replace("'", "''");
            string keepOpenCommand = string.Join("; ", new[]
            {
                $"& '{escapedScriptPath}'",
                "Write-Host ''",
                "Read-Host '[TEST] Press Enter to close this window'"
            });

            string encodedCommand = Convert.ToBase64String(Encoding.Unicode.GetBytes(keepOpenCommand));
            return $"/k powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -EncodedCommand {encodedCommand}";
        }

        private static IntPtr FindVisibleTopLevelWindow(int processId)
        {
            IntPtr found = IntPtr.Zero;

            EnumWindows((windowHandle, _) =>
            {
                GetWindowThreadProcessId(windowHandle, out uint ownerProcessId);
                if (ownerProcessId == processId && IsWindowVisible(windowHandle))
                {
                    found = windowHandle;
                    return false;
                }

                return true;
            }, IntPtr.Zero);

            return found;
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
}