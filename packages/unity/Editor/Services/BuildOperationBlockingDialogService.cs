using System;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using UnityEngine;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Coordinates blocking sync dialog lifecycle for build operations.
    /// </summary>
    public sealed class BuildOperationBlockingDialogService
    {
        private const string BlockingSyncDialogStatusDefault = "Directory syncing...";
        private const string BlockingSyncDialogGuidance = "Do not edit files. Use Git Sync (Pro) to skip.";

        private readonly BuildOperationExecutionService.Request request;

        private bool isActive;
        private string dialogText = "Preparing workspace synchronization...";
        private float dialogProgress;

        public BuildOperationBlockingDialogService(BuildOperationExecutionService.Request request)
        {
            this.request = request;
        }

        public bool IsActive => isActive;

        public void ShowIfNeeded()
        {
            if (!ShouldShowBlockingSyncDialog(request))
            {
                return;
            }

            isActive = true;
            dialogText = "Checking workspace sync status...";
            dialogProgress = 0f;
            BlockingProgressDialog.Show(
                "Preparing Workspace",
                BuildBlockingSyncDialogMessage(dialogText),
                dialogProgress,
                request.OnBlockingSyncCancelRequested);
        }

        public void Update(BuildSyncStatus status, string statusText)
        {
            if (!isActive)
            {
                return;
            }

            if (!string.IsNullOrWhiteSpace(statusText))
            {
                dialogText = statusText;
            }

            if (status == BuildSyncStatus.SYNC_FAILED || status == BuildSyncStatus.BUILD_EXECUTING)
            {
                BlockingProgressDialog.Clear();
                isActive = false;
                return;
            }

            BlockingProgressDialog.Update(BuildBlockingSyncDialogMessage(dialogText), dialogProgress);
        }

        public void UpdateProgress(float progressValue)
        {
            if (!isActive)
            {
                return;
            }

            dialogProgress = Mathf.Clamp01(progressValue);
            BlockingProgressDialog.Update(BuildBlockingSyncDialogMessage(dialogText), dialogProgress);
        }

        public void ClearIfActive()
        {
            if (!isActive)
            {
                return;
            }

            BlockingProgressDialog.Clear();
            isActive = false;
        }

        private static bool ShouldShowBlockingSyncDialog(BuildOperationExecutionService.Request operationRequest)
        {
            if (operationRequest == null || !operationRequest.ShowBlockingSyncDialog || operationRequest.NotarizeOnly || operationRequest.PublishOnly)
            {
                return false;
            }

            BuildProfile profile = operationRequest.Profile;
            if (profile == null)
            {
                return false;
            }

            // Directory sync mode is explicitly represented by useGit == false.
            // Manual execute callers control intent via ShowBlockingSyncDialog.
            return !profile.useGit;
        }

        private static string BuildBlockingSyncDialogMessage(string statusText)
        {
            string primaryText = BuildCompactSyncStatus(statusText);
            return $"{primaryText}\n{BlockingSyncDialogGuidance}";
        }

        private static string BuildCompactSyncStatus(string statusText)
        {
            if (string.IsNullOrWhiteSpace(statusText))
            {
                return BlockingSyncDialogStatusDefault;
            }

            string normalized = statusText.Trim();
            string lower = normalized.ToLowerInvariant();

            if (lower.Contains("use git sync"))
            {
                return BlockingSyncDialogStatusDefault;
            }

            if (lower.Contains("git syncing") || lower.StartsWith("git sync", StringComparison.Ordinal))
            {
                return "Git syncing...";
            }

            if (lower.Contains("sync complete"))
            {
                return "Workspace sync complete.";
            }

            if (lower.Contains("already synchronized") || lower.Contains("already in sync"))
            {
                return "Workspace already synced.";
            }

            if (lower.Contains("sync") || lower.Contains("workspace"))
            {
                return BlockingSyncDialogStatusDefault;
            }

            const int maxStatusLength = 52;
            return normalized.Length <= maxStatusLength
                ? normalized
                : normalized.Substring(0, maxStatusLength - 3) + "...";
        }
    }
}
