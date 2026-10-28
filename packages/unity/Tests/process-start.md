# ProcessStartInfo Notes

Condensed from the attached article and trimmed to the parts that matter for CADET's PowerShell and console-launch behavior.

## Source

Original article:
Guide to ProcessStartInfo in C#: Configuration Settings Explained
Ralf Koch, Jul 3 2025

## Key Properties

### FileName

Specifies the executable or file to launch.

Notes:
- Full paths are the most reliable.
- A bare executable name depends on `PATH`.
- Relative paths depend on the working directory.

Example:
```csharp
startInfo.FileName = @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
```

### Arguments

Provides the command-line arguments passed to the target process.

Notes:
- Arguments are passed as one string.
- Paths with spaces must be quoted.
- The target executable decides how arguments are parsed.

Example:
```csharp
startInfo.Arguments = "-NoProfile -NoExit -ExecutionPolicy Bypass -Command \"Write-Host 'HELLO'\"";
```

### UseShellExecute

Controls whether Windows shell launching is used.

- `true`: Uses the shell.
- `false`: Uses direct process creation.

Use `true` when:
- Opening documents or URLs.
- Using shell verbs like `runas`.
- You want normal Windows shell launch behavior.

Use `false` when:
- You need `RedirectStandardOutput`, `RedirectStandardError`, or `RedirectStandardInput`.
- You need direct control over the child process.

Important:
- If `UseShellExecute = true`, standard stream redirection is not available.
- If `UseShellExecute = false`, the process is launched directly rather than through normal shell behavior.

Example:
```csharp
startInfo.UseShellExecute = true;
```

### WindowStyle

Controls the initial state of the launched window.

Values:
- `Hidden`
- `Minimized`
- `Normal`
- `Maximized`

Important:
- This is mainly meaningful for GUI applications.
- It should not be treated as a guarantee that a console app will get a visible console window.

Example:
```csharp
startInfo.WindowStyle = ProcessWindowStyle.Normal;
```

### CreateNoWindow

Controls whether a console window is created for console applications.

- `true`: no console window
- `false`: allow a console window

Important:
- Only applies when `UseShellExecute = false`.
- GUI applications ignore it.
- `false` does not guarantee a visible, user-facing console window in every host scenario.

Example:
```csharp
startInfo.UseShellExecute = false;
startInfo.CreateNoWindow = true;
```

### RedirectStandardOutput / RedirectStandardError / RedirectStandardInput

Used to capture output or feed input to the child process.

Important:
- Require `UseShellExecute = false`.
- Once you redirect, you are in the direct-launch path rather than normal shell-managed console behavior.
- Long-running output can deadlock if streams are handled incorrectly.

Example:
```csharp
startInfo.UseShellExecute = false;
startInfo.RedirectStandardOutput = true;
startInfo.RedirectStandardError = true;
```

### WorkingDirectory

Sets the working directory for the child process.

Notes:
- Important for scripts and tools that use relative paths.
- Should usually be set explicitly.

Example:
```csharp
startInfo.WorkingDirectory = projectRoot;
```

### Verb

Specifies a shell verb such as `runas`.

Important:
- Shell verbs require `UseShellExecute = true`.

Example:
```csharp
startInfo.UseShellExecute = true;
startInfo.Verb = "runas";
```

## Useful Combinations

### Hidden or Captured Automation

Use when you need logs, captured output, or silent background execution.

```csharp
var startInfo = new ProcessStartInfo
{
    FileName = "powershell.exe",
    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"script.ps1\"",
    UseShellExecute = false,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
    CreateNoWindow = true,
    WorkingDirectory = projectRoot
};
```

Why:
- Best for automation.
- Best for logging.
- Best for controlled execution.
- Not the right pattern if the goal is a visible shell window.

### Visible Interactive Launch

Use when the goal is to let Windows create a normal interactive shell window.

```csharp
var startInfo = new ProcessStartInfo
{
    FileName = "powershell.exe",
    Arguments = "-NoProfile -NoExit -ExecutionPolicy Bypass -Command \"Write-Host 'HELLO'\"",
    UseShellExecute = true,
    WindowStyle = ProcessWindowStyle.Normal,
    WorkingDirectory = projectRoot
};
```

Why:
- Better match for manual interactive PowerShell behavior.
- Compatible with shell-mediated window creation.
- Cannot capture standard output with redirection at the same time.

## Relevance To The Current Unity Issue

The most important takeaway for the CADET tests is this:

- `UseShellExecute = false` is the correct path for capture, logging, and silent automation.
- `UseShellExecute = true` is the better path when the actual goal is a visible interactive PowerShell window.
- `CreateNoWindow = false` does not guarantee that a visible console window will appear when a GUI process launches a console child directly.
- `WindowStyle = Normal` should not be treated as proof that a console window will appear or stay visible.
- If a test is trying to verify a real visible PowerShell window from Unity, it should be treated as a shell-launch scenario, not a redirected direct-process scenario.

## Practical Rule Of Thumb

Use two distinct launch modes on Windows:

1. Visible manual/debug mode

```csharp
UseShellExecute = true
```

2. Hidden captured/logging mode

```csharp
UseShellExecute = false
RedirectStandardOutput = true
RedirectStandardError = true
CreateNoWindow = true
```
