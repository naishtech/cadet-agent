using System;
using System.Diagnostics;
using System.Threading;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Tracks and manages the lifecycle of the active external build process.
    /// Consolidates process registration and kill logic for use across both Lite and Full build paths.
    /// </summary>
    public class ActiveBuildProcessTracker
    {
        private volatile Process activeProcess;

        public Process ActiveProcess => activeProcess;

        public void Register(Process process)
        {
            activeProcess = process;
        }

        public void Clear()
        {
            activeProcess = null;
        }

        public void KillAndClear()
        {
            if (activeProcess == null)
            {
                return;
            }

            try
            {
                bool currentlyRunning = false;
                int processId = 0;
                try
                {
                    currentlyRunning = !activeProcess.HasExited;
                    processId = activeProcess.Id;
                }
                catch (InvalidOperationException)
                {
                    activeProcess = null;
                    return;
                }

                if (currentlyRunning)
                {
                    ProcessKiller.KillProcessTree(processId);
                    Thread.Sleep(1000);

                    try
                    {
                        if (!activeProcess.HasExited)
                        {
                            activeProcess.Kill();
                            activeProcess.WaitForExit(2000);
                        }
                    }
                    catch (InvalidOperationException)
                    {
                        // Already exited.
                    }
                    catch (Exception ex)
                    {
                        UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error with Process.Kill(): {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error during process cleanup: {ex.Message}");
            }
            finally
            {
                activeProcess = null;
            }
        }
    }
}
