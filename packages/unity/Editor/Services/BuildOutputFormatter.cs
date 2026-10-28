using System;
using System.Text.RegularExpressions;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Centralized helpers for classifying build output and extracting useful error summaries.
    /// </summary>
    public static class BuildOutputFormatter
    {
        private static readonly Regex ExitCodeRegex = new Regex(@"exited with code:\s*(\d+)", RegexOptions.IgnoreCase);
        private static readonly Regex TimestampRegex = new Regex(@"\[\d{2}:\d{2}:\d{2}\]\s*");

        public static CadetConsoleMessageType DetermineMessageType(string line)
        {
            if (string.IsNullOrEmpty(line))
            {
                return CadetConsoleMessageType.Log;
            }

            string lowerLine = line.ToLower();

            if (line.Contains("[ERROR]") || line.Contains("[ERR]"))
            {
                return CadetConsoleMessageType.Error;
            }

            if (lowerLine.Contains("build failed") ||
                (lowerLine.Contains("unity") && lowerLine.Contains("failed")) ||
                (lowerLine.Contains("steam") && lowerLine.Contains("failed")) ||
                (lowerLine.Contains("epic") && lowerLine.Contains("failed")) ||
                lowerLine.Contains("application will terminate") ||
                lowerLine.Contains("uncaught exception") ||
                lowerLine.Contains("terminating on uncaught sigsegv") ||
                lowerLine.Contains("sigsegv") ||
                lowerLine.Contains("exception:") ||
                lowerLine.Contains("error:"))
            {
                return CadetConsoleMessageType.Error;
            }

            if (lowerLine.Contains("exited with code"))
            {
                Match match = ExitCodeRegex.Match(line);
                if (match.Success)
                {
                    if (int.TryParse(match.Groups[1].Value, out int exitCode) && exitCode != 0)
                    {
                        return CadetConsoleMessageType.Error;
                    }
                }
                else
                {
                    return CadetConsoleMessageType.Error;
                }
            }

            if (line.Contains("[WARN]") || lowerLine.Contains("warning:"))
            {
                return CadetConsoleMessageType.Warning;
            }

            if (line.Contains("[SUCCESS]"))
            {
                return CadetConsoleMessageType.Success;
            }

            if (line.Contains("[PROG]"))
            {
                return CadetConsoleMessageType.Progress;
            }

            return CadetConsoleMessageType.Log;
        }

        public static bool DetectBuildFailure(string output, int exitCode)
        {
            if (exitCode != 0)
            {
                return true;
            }

            if (string.IsNullOrEmpty(output))
            {
                return false;
            }

            string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string line in lines)
            {
                string lowerLine = line.ToLower();
                if (lowerLine.Contains("build failed") ||
                    (lowerLine.Contains("unity") && lowerLine.Contains("failed")) ||
                    (lowerLine.Contains("steam") && lowerLine.Contains("failed")) ||
                    (lowerLine.Contains("epic") && lowerLine.Contains("failed")) ||
                    (lowerLine.Contains("exited with code") && !lowerLine.Contains("exited with code: 0")) ||
                    lowerLine.Contains("application will terminate with return code") ||
                    lowerLine.Contains("uncaught exception"))
                {
                    return true;
                }
            }

            return false;
        }

        public static string ExtractErrorMessage(string output, int exitCode, bool isWindowsEditor)
        {
            if (!string.IsNullOrEmpty(output))
            {
                string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                foreach (string line in lines)
                {
                    if (line.Contains("Process was terminated (killed externally)") ||
                        line.Contains("killed externally"))
                    {
                        return "Build process was terminated (killed externally)";
                    }
                }
            }

            bool wasKilled = isWindowsEditor ? exitCode == -1 : exitCode < 0 || exitCode >= 128;
            if (wasKilled && exitCode != 0)
            {
                return "Build process was terminated (killed externally)";
            }

            if (string.IsNullOrEmpty(output))
            {
                if (exitCode != 0)
                {
                    return $"Build process exited with code {exitCode}";
                }

                return "Unknown error occurred";
            }

            string[] outputLines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string line in outputLines)
            {
                string lowerLine = line.ToLower();
                if (lowerLine.Contains("build failed") ||
                    (lowerLine.Contains("unity") && lowerLine.Contains("failed")) ||
                    (lowerLine.Contains("steam") && lowerLine.Contains("failed")) ||
                    (lowerLine.Contains("epic") && lowerLine.Contains("failed")))
                {
                    string cleanLine = TimestampRegex.Replace(line.Trim(), "").Trim();
                    if (cleanLine.Length > 200)
                    {
                        cleanLine = cleanLine.Substring(0, 197) + "...";
                    }

                    return cleanLine;
                }
            }

            foreach (string line in outputLines)
            {
                if (line.Contains("[ERROR]") || line.Contains("ERROR:"))
                {
                    string cleanLine = line.Trim();
                    if (cleanLine.Length > 200)
                    {
                        cleanLine = cleanLine.Substring(0, 197) + "...";
                    }

                    return cleanLine;
                }
            }

            if (exitCode != 0)
            {
                return $"Build process exited with code {exitCode}";
            }

            return "Build failed (see console output for details)";
        }
    }
}
