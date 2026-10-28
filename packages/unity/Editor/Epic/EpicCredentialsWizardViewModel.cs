using System;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Epic
{
    /// <summary>
    /// ViewModel for Epic Credentials Wizard - manages wizard state and business logic
    /// </summary>
    public class EpicCredentialsWizardViewModel
    {
        private EpicWizardStep currentStep;
        private EpicCredentials credentials;
        private string statusMessage;
        private bool isCheckingCredentials;
        private bool credentialsValidated;
        private string consoleOutput = "";
        
        public EpicWizardStep CurrentStep
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
        
        public EpicCredentials Credentials
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
        
        // Events
        public event Action<EpicWizardStep> CurrentStepChanged;
        public event Action<EpicCredentials> CredentialsChanged;
        public event Action<string> StatusMessageChanged;
        public event Action<bool> IsCheckingCredentialsChanged;
        public event Action<bool> CredentialsValidatedChanged;
        public event Action OnCredentialsCheckRequested;
        public event Action OnSaveRequested;
        public event Action OnCancelRequested;
        public event Action<string> ConsoleOutputChanged;
        
        public EpicCredentialsWizardViewModel()
        {
            Initialize();
        }
        
        public void Initialize()
        {
            // Load existing credentials if available
            Credentials = EpicCredentialsHelper.ReadCredentials();
            
            CurrentStep = EpicWizardStep.Credentials;
            CredentialsValidated = false;
            StatusMessage = "";
            IsCheckingCredentials = false;
            ConsoleOutput = "";
        }
        
        public void UpdateConsoleOutput(string output)
        {
            ConsoleOutput = output;
        }
        
        public void UpdateClientId(string clientId)
        {
            if (Credentials == null)
                Credentials = new EpicCredentials();
            
            Credentials.ClientId = clientId;
            CredentialsChanged?.Invoke(Credentials);
        }
        
        public void UpdateClientSecret(string clientSecret)
        {
            if (Credentials == null)
                Credentials = new EpicCredentials();
            
            Credentials.ClientSecret = clientSecret;
            CredentialsChanged?.Invoke(Credentials);
        }
        
        public void RequestCheckCredentials()
        {
            if (string.IsNullOrEmpty(Credentials?.ClientId) || string.IsNullOrEmpty(Credentials?.ClientSecret))
            {
                StatusMessage = "❌ " + CadetLocalization.GetString("Window.EpicCredentialsWizard.InvalidCredentials");
                return;
            }
            
            IsCheckingCredentials = true;
            CredentialsValidated = false;
            StatusMessage = CadetLocalization.GetString("Window.EpicCredentialsWizard.CheckingCredentials");
            OnCredentialsCheckRequested?.Invoke();
        }
        
        public void OnCredentialsCheckComplete(EpicValidationResult result)
        {
            IsCheckingCredentials = false;
            
            switch (result.Type)
            {
                case EpicValidationResultType.Success:
                    StatusMessage = "✅ " + CadetLocalization.GetString("Window.EpicCredentialsWizard.CredentialsVerified");
                    CredentialsValidated = true;
                    // Save credentials immediately and close wizard
                    if (SaveCredentials())
                    {
                        // Credentials saved successfully - wizard will close
                        OnSaveRequested?.Invoke();
                    }
                    break;
                    
                case EpicValidationResultType.InvalidCredentials:
                    StatusMessage = "❌ " + (result.ErrorMessage ?? CadetLocalization.GetString("Window.EpicCredentialsWizard.InvalidCredentials"));
                    CredentialsValidated = false;
                    break;
                    
                case EpicValidationResultType.ConnectionFailed:
                    StatusMessage = "❌ " + result.ErrorMessage;
                    CredentialsValidated = false;
                    break;
            }
        }
        
        public void RequestSave()
        {
            if (string.IsNullOrEmpty(Credentials?.ClientId) || string.IsNullOrEmpty(Credentials?.ClientSecret))
            {
                StatusMessage = "❌ " + CadetLocalization.GetString("Window.EpicCredentialsWizard.InvalidCredentials");
                return;
            }
            
            OnSaveRequested?.Invoke();
        }
        
        public bool SaveCredentials()
        {
            if (EpicCredentialsHelper.WriteCredentials(Credentials))
            {
                return true;
            }
            else
            {
                StatusMessage = "❌ " + CadetLocalization.GetString("Window.EpicCredentialsWizard.SaveFailed");
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

