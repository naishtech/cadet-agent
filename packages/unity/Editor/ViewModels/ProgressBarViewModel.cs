using System;
using UnityEngine;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// Enumeration of progress bar display modes
    /// </summary>
    public enum ProgressMode
    {
        None,
        Indeterminate,
        Determinate,
        Pulsing
    }
    
    /// <summary>
    /// ViewModel for progress bar - manages progress tracking and display
    /// </summary>
    public class ProgressBarViewModel
    {
        private ProgressMode mode;
        private float progress;
        private string statusText;
        private DateTime startTime;
        private bool isRunning;
        private bool canCancel;
        private bool hasError;
        private bool hasSuccess;
        
        public ProgressMode Mode
        {
            get => mode;
            private set
            {
                if (mode != value)
                {
                    mode = value;
                    ModeChanged?.Invoke(value);
                }
            }
        }
        
        public float Progress
        {
            get => progress;
            private set
            {
                if (Math.Abs(progress - value) > 0.001f)
                {
                    progress = value;
                    ProgressChanged?.Invoke(value);
                }
            }
        }
        
        public string StatusText
        {
            get => statusText;
            private set
            {
                if (statusText != value)
                {
                    statusText = value;
                    StatusTextChanged?.Invoke(value);
                }
            }
        }
        
        public TimeSpan ElapsedTime
        {
            get
            {
                if (startTime != default(DateTime))
                    return DateTime.Now - startTime;
                return TimeSpan.Zero;
            }
        }
        
        public bool IsRunning
        {
            get => isRunning;
            private set
            {
                if (isRunning != value)
                {
                    isRunning = value;
                    IsRunningChanged?.Invoke(value);
                }
            }
        }
        
        public bool CanCancel
        {
            get => canCancel;
            private set
            {
                if (canCancel != value)
                {
                    canCancel = value;
                    CanCancelChanged?.Invoke(value);
                }
            }
        }
        
        public bool HasError
        {
            get => hasError;
            private set
            {
                if (hasError != value)
                {
                    hasError = value;
                }
            }
        }
        
        public bool HasSuccess
        {
            get => hasSuccess;
            private set
            {
                if (hasSuccess != value)
                {
                    hasSuccess = value;
                }
            }
        }
        
        // Events
        public event Action<ProgressMode> ModeChanged;
        public event Action<float> ProgressChanged;
        public event Action<string> StatusTextChanged;
        public event Action<bool> IsRunningChanged;
        public event Action<bool> CanCancelChanged;
        public event Action OnCancelRequested;
        
        public ProgressBarViewModel()
        {
            mode = ProgressMode.None;
            progress = 0f;
            statusText = "";
            isRunning = false;
            canCancel = false;
        }
        
        public void Start(string initialStatus = "")
        {
            Mode = ProgressMode.Indeterminate;
            Progress = 0f;
            StatusText = initialStatus;
            startTime = DateTime.Now;
            IsRunning = true;
            CanCancel = true;
        }
        
        public void SetProgress(float progressValue, string status = "")
        {
            Mode = ProgressMode.Determinate;
            Progress = Mathf.Clamp01(progressValue);
            if (!string.IsNullOrEmpty(status))
                StatusText = status;
            IsRunning = true;
            CanCancel = true;
        }
        
        public void SetStatus(string status)
        {
            StatusText = status;
        }
        
        public void Stop()
        {
            Mode = ProgressMode.None;
            Progress = 0f;
            StatusText = "";
            IsRunning = false;
            CanCancel = false;
            HasError = false;
            HasSuccess = false;
            startTime = default(DateTime);
        }
        
        public void StopWithError(string errorMessage)
        {
            Mode = ProgressMode.None;
            Progress = 0f;
            StatusText = string.IsNullOrEmpty(errorMessage) ? "Build failed" : errorMessage;
            IsRunning = false;
            CanCancel = false;
            HasError = true;
            HasSuccess = false;
            startTime = default(DateTime);
        }
        
        public void StopWithSuccess(string successMessage)
        {
            Mode = ProgressMode.None;
            Progress = 0f;
            StatusText = string.IsNullOrEmpty(successMessage) ? "Build completed successfully" : successMessage;
            IsRunning = false;
            CanCancel = false;
            HasError = false;
            HasSuccess = true;
            startTime = default(DateTime);
        }
        
        public void RequestCancel()
        {
            OnCancelRequested?.Invoke();
        }
    }
}

