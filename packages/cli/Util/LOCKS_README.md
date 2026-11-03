# CADET CLI Process Lock System

## Overview

The process lock system prevents concurrent operations that could conflict with each other. This ensures safe execution of builds and uploads.

## Locked Operations

### 1. Unity Builds
**Lock Name**: `unity_build_<PROJECT_NAME>`

Prevents multiple Unity builds of the same project from running simultaneously. This avoids:
- File conflicts in the build output directory
- Unity editor crashes from multiple instances accessing the same project
- Resource exhaustion from parallel builds

**Example**: When building "MyGame", the lock `unity_build_MyGame` is held.

### 2. Steam Uploads
**Lock Name**: `steamcmd_<APP_ID>`

Prevents multiple SteamCMD uploads to the same Steam app from running concurrently. This avoids:
- Conflicting depot updates
- Authentication issues with shared sentry files
- Steam API rate limiting

**Example**: When uploading to Steam app 3155820, the lock `steamcmd_3155820` is held.

## Lock Management

### View All Locks
```powershell
# Windows (PowerShell)
cd F:\unity\projects\cadet
$bashPath = Join-Path (Get-Location) "Tools\ThirdParty~\cosmos-4.0.2~\bin\bash"
$cmd = "cd /f/unity/projects/cadet; PATH='/f/unity/projects/cadet/Tools/ThirdParty~/cosmos-4.0.2~/bin:`$PATH'; bash Tools/CLI/Util/manage_locks.sh list"
Start-Process -FilePath $bashPath -ArgumentList "-lc `"$cmd`"" -NoNewWindow -Wait
```

### Clean Stale Locks
```powershell
# Windows (PowerShell)
cd F:\unity\projects\cadet
$bashPath = Join-Path (Get-Location) "Tools\ThirdParty~\cosmos-4.0.2~\bin\bash"
$cmd = "cd /f/unity/projects/cadet; PATH='/f/unity/projects/cadet/Tools/ThirdParty~/cosmos-4.0.2~/bin:`$PATH'; bash Tools/CLI/Util/manage_locks.sh clean"
Start-Process -FilePath $bashPath -ArgumentList "-lc `"$cmd`"" -NoNewWindow -Wait
```

### Manually Remove a Specific Lock
```powershell
# If you're certain a process isn't running, you can manually remove its lock
Remove-Item "Tools\.locks\unity_build_MyGame.lock"
Remove-Item "Tools\.locks\steamcmd_3155820.lock"
```

## How It Works

### 1. Lock Acquisition
When a process starts, it:
1. Checks if a lock file exists for the operation
2. If it exists, checks if that process (PID) is still running
3. If running → **FAILS** with error message
4. If not running → Removes stale lock and continues
5. Creates new lock file with current PID and timestamp

### 2. Lock Release
When a process exits (success or failure):
1. A `trap` handler automatically releases the lock
2. The lock file is removed
3. Other processes can now acquire the lock

### 3. Stale Lock Detection
Locks are automatically cleaned up when:
- The process that created them is no longer running
- You run `bash Tools/CLI/Util/manage_locks.sh clean`
- Another process attempts to acquire the same lock

## Lock File Format

Lock files are stored in `Tools/.locks/` and contain:

```
PROCESS: unity_build_MyGame
PID: 12345
TIME: 2025-12-18 02:30:45
HOST: DESKTOP-ABC123
```

## Testing the Lock System

### Test 1: Manual Concurrent Attempt

**Terminal 1** - Start a publish:
```powershell
.\start_publish_test.ps1
```

**Terminal 2** - While it's running, check locks and try another:
```powershell
.\check_lock.ps1
```

You should see:
```
[ERR] Process 'steamcmd_3155820' is already running (PID: 12345, Started: ...)
[ERR] Cannot start Steam upload - another upload is already in progress
```

### Test 2: Programmatic Test

Run the automated test:
```powershell
.\Test\test_process_locks.ps1
```

## Troubleshooting

### "Another build/upload is already in progress" but nothing is running

**Cause**: Stale lock from a crashed or interrupted process.

**Solution**:
```powershell
# Option 1: Clean all stale locks automatically
cd F:\unity\projects\cadet
$bashPath = Join-Path (Get-Location) "Tools\ThirdParty~\cosmos-4.0.2~\bin\bash"
$cmd = "cd /f/unity/projects/cadet; PATH='/f/unity/projects/cadet/Tools/ThirdParty~/cosmos-4.0.2~/bin:`$PATH'; bash Tools/CLI/Util/manage_locks.sh clean"
Start-Process -FilePath $bashPath -ArgumentList "-lc `"$cmd`"" -NoNewWindow -Wait

# Option 2: Manually remove the specific lock
Remove-Item "Tools\.locks\steamcmd_3155820.lock"
```

### Lock not releasing after CTRL+C

**Cause**: The `trap` handler should catch this, but in rare cases it might not.

**Solution**: Run the clean command or manually remove the lock file.

### Locks persist across reboots

**Cause**: This is expected behavior - lock files are just files on disk.

**Solution**: Run `bash Tools/manage_locks.sh clean` after a reboot to clean up any stale locks.

## Implementation Details

### Source Files
- **`Tools/CLI/Util/process_lock.sh`** - Core lock functions
- **`Tools/CLI/Steam/publish.sh`** - Acquires `steamcmd_<APP_ID>` lock
- **`Tools/CLI/build.sh`** - Acquires `unity_build_<PROJECT>` lock
- **`Tools/CLI/Util/manage_locks.sh`** - Lock management utility

### Cross-Platform Support
The lock system works on:
- ✅ Windows (using `tasklist` for PID checking)
- ✅ macOS (using `ps` for PID checking)
- ✅ Linux (using `ps` for PID checking)

### Performance Impact
Negligible - lock operations take <50ms:
- Acquire: Check PID, write lock file
- Release: Delete lock file
- Check: Read lock file, check PID

## Future Enhancements

Potential improvements (not yet implemented):
- Lock timeout/TTL for automatic cleanup after N hours
- Lock ownership transfer for chained operations
- Advisory vs. mandatory lock modes
- Distributed locks for networked builds

