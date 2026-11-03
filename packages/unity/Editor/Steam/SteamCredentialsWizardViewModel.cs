using System;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// ViewModel for Steam Credentials Wizard - manages wizard state and business logic
    /// </summary>
    public class SteamCredentialsWizardViewModel
    {
        private WizardStep currentStep;
        private SteamCredentials credentials;
        private string statusMessage;
        private bool isCheckingCredentials;
        private bool credentialsValidated;
        private bool needsGuardCode;
        private string consoleOutput = "";
        private int remainingSeconds = 0;
        private bool skipValidation = false;
        private bool isValidatingCredentials = false;
        private int validatingRemainingSeconds = 0;
        
        public WizardStep CurrentStep
        {
            get => currentStep;
            private set
            {
                if (currentStep != value)
                {
                    currentStep = value;
                    CurrentStepChanged?.Invoke(value);
                }
            }
        }
        
        public SteamCredentials Credentials
        {
            get => credentials;
            private set
            {
                if (credentials != value)
                {
                    credentials = value;
                    CredentialsChanged?.Invoke(value);
                }
            }
        }
        
        public string StatusMessage
        {
            get => statusMessage;
            private set
            {
                if (statusMessage != value)
                {
                    statusMessage = value;
                    StatusMessageChanged?.Invoke(value);
                }
            }
        }
        
        public bool IsCheckingCredentials
        {
            get => isCheckingCredentials;
            private set
            {
                if (isCheckingCredentials != value)
                {
                    isCheckingCredentials = value;
                    IsCheckingCredentialsChanged?.Invoke(value);
                }
            }
        }
        
        public bool CredentialsValidated
        {
            get => credentialsValidated;
            private set
            {
                if (credentialsValidated != value)
                {
                    credentialsValidated = value;
                    CredentialsValidatedChanged?.Invoke(value);
                }
            }
        }
        
        public bool NeedsGuardCode
        {
            get => needsGuardCode;
        }
        
        public string ConsoleOutput
        {
            get => consoleOutput;
            private set
            {
                if (consoleOutput != value)
                {
                    consoleOutput = value;
                    ConsoleOutputChanged?.Invoke(value);
                }
            }
        }
        
        public int RemainingSeconds
        {
            get => remainingSeconds;
            private set
            {
                if (remainingSeconds != value)
                {
                    remainingSeconds = value;
                    RemainingSecondsChanged?.Invoke(value);
                }
            }
        }
        
        public bool SkipValidation
        {
            get => skipValidation;
        }
        
        public bool IsValidatingCredentials
        {
            get => isValidatingCredentials;
            private set
            {
                if (isValidatingCredentials != value)
                {
                    isValidatingCredentials = value;
                    IsValidatingCredentialsChanged?.Invoke(value);
                }
            }
        }
        
        public int ValidatingRemainingSeconds
        {
            get => validatingRemainingSeconds;
            private set
            {
                if (validatingRemainingSeconds != value)
                {
                    validatingRemainingSeconds = value;
                    ValidatingRemainingSecondsChanged?.Invoke(value);
                }
            }
        }
        
        // Events
        public event Action<WizardStep> CurrentStepChanged;
        public event Action<SteamCredentials> CredentialsChanged;
        public event Action<string> StatusMessageChanged;
        public event Action<bool> IsCheckingCredentialsChanged;
        public event Action<bool> CredentialsValidatedChanged;
        public event Action OnCredentialsCheckRequested;
        public event Action OnSaveRequested;
        public event Action OnGuardCodeSubmitRequested;
        public event Action OnCancelRequested;
        public event Action<string> ConsoleOutputChanged;
        public event Action<int> RemainingSecondsChanged;
        public event Action<bool> SkipValidationChanged;
        public event Action<bool> IsValidatingCredentialsChanged;
        public event Action<int> ValidatingRemainingSecondsChanged;
        
        public SteamCredentialsWizardViewModel()
        {
            Initialize();
        }
        
        public void Initialize()
        {
            // Load existing credentials if available
            Credentials = SteamCredentialsHelper.ReadCredentials();
            
            // Clear guard code - it's always a new code for each login attempt
            if (Credentials != null)
            {
                Credentials.GuardCode = "";
            }
            
            // Check if we need guard code (first time setup)
            needsGuardCode = !SteamCredentialsHelper.CredentialsFileExists() || 
                            string.IsNullOrEmpty(Credentials?.GuardCode);
            
            CurrentStep = WizardStep.LoginCredentials;
            CredentialsValidated = false;
            StatusMessage = "";
            IsCheckingCredentials = false;
            ConsoleOutput = "";
            RemainingSeconds = 0;
            IsValidatingCredentials = false;
            ValidatingRemainingSeconds = 0;
        }
        
        public void UpdateConsoleOutput(string output)
        {
            ConsoleOutput = output;
        }
        
        public void UpdateUsername(string username)
        {
            if (Credentials == null)
                Credentials = new SteamCredentials();
            
            Credentials.Username = username;
            CredentialsChanged?.Invoke(Credentials);
        }
        
        public void UpdatePassword(string password)
        {
            if (Credentials == null)
                Credentials = new SteamCredentials();
            
            Credentials.Password = password;
            CredentialsChanged?.Invoke(Credentials);
        }
        
        public void UpdateGuardCode(string guardCode)
        {
            if (Credentials == null)
                Credentials = new SteamCredentials();
            
            // Limit to 5 characters, allow alphanumeric only, convert to uppercase
            guardCode = System.Text.RegularExpressions.Regex.Replace(guardCode, @"[^a-zA-Z0-9]", "");
            guardCode = guardCode.ToUpperInvariant();
            
            if (guardCode.Length > 5)
                guardCode = guardCode.Substring(0, 5);
            
            Credentials.GuardCode = guardCode;
            CredentialsChanged?.Invoke(Credentials);
        }
        
        public void UpdateSkipValidation(bool value)
        {
            if (skipValidation != value)
            {
                skipValidation = value;
                SkipValidationChanged?.Invoke(value);
            }
        }
        
        public void RequestCheckCredentials()
        {
            if (string.IsNullOrEmpty(Credentials?.Username) || string.IsNullOrEmpty(Credentials?.Password))
            {
                StatusMessage = "❌ " + CadetLocalization.GetString("Window.SteamCredentialsWizard.InvalidCredentials");
                return;
            }
            
            // If skip validation is enabled, go directly to optional guard code step
            if (skipValidation)
            {
                needsGuardCode = true;
                CurrentStep = WizardStep.OptionalGuardCode;
                StatusMessage = "";
                // Clear any existing guard code - it's always a new code
                if (Credentials != null)
                {
                    Credentials.GuardCode = "";
                    CredentialsChanged?.Invoke(Credentials);
                }
                return;
            }
            
            IsCheckingCredentials = true;
            CredentialsValidated = false;
            StatusMessage = CadetLocalization.GetString("Window.SteamCredentialsWizard.CheckingCredentials");
            RemainingSeconds = 120; // 2 minutes
            OnCredentialsCheckRequested?.Invoke();
        }
        
        public void UpdateRemainingSeconds(int seconds)
        {
            RemainingSeconds = seconds;
        }
        
        public void StartValidatingCredentials()
        {
            IsValidatingCredentials = true;
            ValidatingRemainingSeconds = 5;
        }
        
        public void UpdateValidatingRemainingSeconds(int seconds)
        {
            ValidatingRemainingSeconds = seconds;
        }
        
        public void StopValidatingCredentials()
        {
            IsValidatingCredentials = false;
            ValidatingRemainingSeconds = 0;
        }
        
        public void OnCredentialsCheckComplete(ValidationResult result)
        {
            IsCheckingCredentials = false;
            RemainingSeconds = 0; // Reset countdown
            
            switch (result.Type)
            {
                case ValidationResultType.Success:
                    // Transition to WaitingForProcess step - process will be launched
                    CurrentStep = WizardStep.WaitingForProcess;
                    StatusMessage = "";
                    CredentialsValidated = false;
                    break;
                    
                case ValidationResultType.RequiresGuardCode:
                    StatusMessage = "⚠️ Steam Guard code required. Please check your email.";
                    // Automatically transition to guard code step
                    CurrentStep = WizardStep.WaitingForProcess;
                    needsGuardCode = true;
                    CredentialsValidated = false;
                    break;
                    
                case ValidationResultType.InvalidCredentials:
                    StatusMessage = "❌ " + (result.ErrorMessage ?? CadetLocalization.GetString("Window.SteamCredentialsWizard.InvalidCredentials"));
                    CredentialsValidated = false;
                    // Return to login credentials screen to show the error message
                    CurrentStep = WizardStep.LoginCredentials;
                    break;
                    
                case ValidationResultType.ConnectionFailed:
                    StatusMessage = "❌ " + result.ErrorMessage;
                    CredentialsValidated = false;
                    break;
            }
        }
        
        public void OnProcessFinished()
        {
            // Process has finished, transition to optional guard code step
            CurrentStep = WizardStep.OptionalGuardCode;
            StatusMessage = "";
            // Clear any existing guard code
            if (Credentials != null)
            {
                Credentials.GuardCode = "";
                CredentialsChanged?.Invoke(Credentials);
            }
        }
        
        public void RequestSubmitGuardCode()
        {
            if (string.IsNullOrEmpty(Credentials?.GuardCode) || Credentials.GuardCode.Length != 5)
            {
                StatusMessage = "❌ " + CadetLocalization.GetString("Window.SteamCredentialsWizard.InvalidGuardCode");
                return;
            }
            
            IsCheckingCredentials = true;
            StatusMessage = "Submitting guard code...";
            OnGuardCodeSubmitRequested?.Invoke();
        }
        
        public void OnGuardCodeSubmitComplete(bool success, string errorMessage = null)
        {
            IsCheckingCredentials = false;
            
            if (success)
            {
                StatusMessage = "✅ " + CadetLocalization.GetString("Window.SteamCredentialsWizard.CredentialsVerified");
                CredentialsValidated = true;
            }
            else
            {
                StatusMessage = "❌ " + (errorMessage ?? "Failed to submit guard code");
                CredentialsValidated = false;
            }
        }
        
        public void MoveToNextStep()
        {
            // This method is no longer used in the new flow
            // LoginCredentials -> WaitingForProcess -> OptionalGuardCode flow is handled via OnCredentialsCheckComplete and OnProcessFinished
            // Keeping as no-op for backward compatibility
        }
        
        public void MoveToPreviousStep()
        {
            if (CurrentStep == WizardStep.OptionalGuardCode)
            {
                CurrentStep = WizardStep.LoginCredentials;
                StatusMessage = "";
            }
        }
        
        public void RequestSave()
        {
            // For OptionalGuardCode step, guard code is optional - validate only if provided
            if (CurrentStep == WizardStep.OptionalGuardCode)
            {
                if (!string.IsNullOrEmpty(Credentials?.GuardCode) && Credentials.GuardCode.Length != 5)
                {
                    StatusMessage = "❌ " + CadetLocalization.GetString("Window.SteamCredentialsWizard.InvalidGuardCode");
                    return;
                }
                // Save credentials (with or without guard code)
                if (SaveCredentials())
                {
                    OnSaveRequested?.Invoke();
                }
                return;
            }
            
            // Legacy path (should not be reached with new flow)
            OnSaveRequested?.Invoke();
        }
        
        public bool SaveCredentials()
        {
            if (SteamCredentialsHelper.WriteCredentials(Credentials))
            {
                return true;
            }
            else
            {
                StatusMessage = "❌ " + CadetLocalization.GetString("Window.SteamCredentialsWizard.SaveFailed");
                return false;
            }
        }
        
        public void RequestCancel()
        {
            if (IsCheckingCredentials)
            {
                IsCheckingCredentials = false;
                StatusMessage = "Operation cancelled";
                OnCancelRequested?.Invoke();
            }
        }
    }
}

