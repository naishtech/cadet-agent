# CADET Localization Setup Guide

This document describes how localization works in the CADET editor windows.

## Overview

All user-facing strings in CADET editor windows have been externalized and can be localized. Strings are accessed through the `CadetLocalization` helper class, which provides a simple API for retrieving localized text.

**Important:** The Unity Localization Package is **optional**. CADET works with or without it:
- **With Unity Localization Package:** Uses the full Unity Localization system for managing translations
- **Without Unity Localization Package:** Automatically falls back to reading the CSV file directly (`CADET_Localization_en.csv`)

The system automatically detects which method to use at runtime.

## Setup Steps

### Option A: Using Unity Localization Package (Recommended for Multi-Language Support)

If you want to use Unity's full Localization Package with support for multiple languages:

### 1. Install Unity Localization Package

1. Open `Window > Package Manager`
2. Click "+" and select "Add package by name"
3. Enter: `com.unity.localization`
4. Click "Add"

### 2. Create Localization Settings (if not already done)

1. Go to `Edit > Project Settings > Localization`
2. If no Localization Settings exist, click "Create" to generate them
3. This creates a Localization Settings asset in your project

### 3. Create Locales

1. In the Localization Settings window, click on the "Locale Generator" button
2. Select "en" (English) as the default locale
3. Click "Create Locales" and save the locale asset
4. Add the "en" locale to the "Specific Locale Selector" field to set it as default

### 4. Create String Table Collection

1. Go to `Window > Asset Management > Localization Tables`
2. Click the "+" button and select "String Table Collection"
3. Name the collection: **"CADET"** (must match exactly, case-sensitive)
4. Save it in your project (recommended location: `Assets/Covyne/Cadet/Editor/Localization/`)

### 5. Import Strings from CSV (Recommended)

Unity Localization Package supports CSV import/export, which makes managing strings much easier than manually entering them in the Unity Editor UI.

**CSV Import Steps:**

1. Locate the CSV template file: `Assets/Covyne/Cadet/Editor/Localization/CADET_Localization.csv`
2. In the Unity Editor, open `Window > Asset Management > Localization Tables`
3. Select the "CADET" String Table Collection
4. Click the "Import CSV" button (or use the menu option)
5. Select the `CADET_Localization.csv` file
6. Unity will import all the keys and values into the String Table Collection

**CSV Format:**

The CSV file uses the following format according to Unity's official documentation:
- First column: `Key` - The localization key (must be quoted)
- Second column: `Id` - Unique ID (can be left empty - Unity will auto-generate)
- Subsequent columns: Locale identifiers matching exactly what's in Unity (e.g., `English(en)`, `French(fr)`, etc.)
- **Critical:** The locale header must match the **exact** locale identifier format used in Unity's Locale settings (typically `English(en)` with no space before the parenthesis)
- **Important:** Both keys and values must be enclosed in double quotes

**To find the correct locale identifier format:**

1. In Unity, go to `Window > Asset Management > Localization Tables`
2. Select your String Table Collection
3. Click "Export CSV" to see the exact format Unity uses
4. The format is typically `English(en)` (no space before parenthesis), not `English (en)`

Example format (matching Unity's export):
```csv
Key,Id,English(en)
"Window.ProfileEditor.Fields.ProfileName",,"Profile Name"
"Window.ProfileEditor.Tooltips.ProfileName",,"A unique name to identify this build profile"
"Window.ProfileEditor.Tooltips.Platform",,"Target platform: Steam, Epic Games Store, or both"
```

**Note:** 
- Keys must be quoted: `"Window.ProfileEditor.Fields.ProfileName"`
- Values must be quoted: `"Profile Name"`
- The `Id` column can be left empty (Unity will auto-generate IDs on import)
- The provided CSV template uses `English(en)` as the locale header - if your Unity project uses a different format, export a table first to see the exact format Unity expects

**Adding More Locales:**

To add translations for additional languages:

1. Open the CSV file in a spreadsheet editor (Excel, Google Sheets, etc.)
2. Add a new column for the locale code (e.g., `es` for Spanish, `fr` for French)
3. Add translations in the new column
4. In Unity, re-import the CSV file or use the "Import CSV" option to update the String Table Collection

**Exporting to CSV:**

To export the current String Table Collection to CSV:

1. Select the "CADET" String Table Collection in Unity Editor
2. Click the "Export CSV" button
3. Save the CSV file - this creates a backup and allows editing in spreadsheet applications

### 6. Manual Entry (Alternative to CSV)

If you prefer to add entries manually using the following key naming convention:

```
Window.{WindowName}.{Category}.{Item}
```

**Categories:**
- `Fields` - Field labels
- `Tooltips` - Tooltip text for fields
- `Buttons` - Button labels
- `Messages` - Status/error messages
- `Dialogs` - Dialog titles and messages
- `Options` - Dropdown option values
- `Sections` - Section headers

**Examples:**
- `Window.ProfileEditor.Fields.ProfileName` → "Profile Name"
- `Window.ProfileEditor.Tooltips.ProfileName` → "A unique name to identify this build profile"
- `Window.ProfileEditor.Buttons.Save` → "Save"
- `Window.Cadet.Header` → "CADET - Cross-platform Automated Deployment Engine & Tooling"

### Option B: Using CSV File Directly (No Package Required)

If you don't want to install the Unity Localization Package, CADET will automatically read the CSV file directly:

1. Ensure the CSV file exists at: `Assets/Covyne/Cadet/Editor/Localization/CADET_Localization_en.csv`
2. That's it! The system will automatically detect and use the CSV file.

**Note:** When using CSV directly, only English (en) is supported. To add more languages, you'll need to install the Unity Localization Package.

### Complete List of String Keys

A complete list of all string keys is included in the CSV template file (`CADET_Localization.csv`). You can also find keys by searching for `CadetLocalization.GetString(` in the codebase. All keys follow the naming convention above.

## How It Works

The `CadetLocalization` class automatically chooses the best method:

1. **First:** Checks if Unity Localization Package is available
   - If yes, uses the String Table Collection named "CADET"
   - Falls back to CSV if the collection doesn't exist or key is not found

2. **Fallback:** Reads `CADET_Localization_en.csv` directly
   - Parses the CSV file and caches the values
   - Works without any Unity packages

### Fallback Behavior

If a string key is not found in the localization table, the `CadetLocalization.GetString()` method will:
1. Return the fallback string (if provided via `GetStringWithFallback()`)
2. Return the key itself (if using `GetString()`)

This ensures the UI remains functional even if localization is not fully set up.

## Usage in Code

```csharp
using Covyne.CADET.Editor.Localization;

// Simple usage - returns key if not found
string text = CadetLocalization.GetString("Window.ProfileEditor.Fields.ProfileName");

// With fallback
string text = CadetLocalization.GetStringWithFallback("Window.ProfileEditor.Fields.ProfileName", "Profile Name");
```

## Notes

- **Unity Localization Package is optional** - CADET works without it by reading the CSV file directly
- The String Table Collection name "CADET" is used when Unity Localization Package is available
- The CSV file path `CADET_Localization_en.csv` is used as fallback when the package is not available
- All strings default to English (en) locale
- The localization system gracefully handles missing keys by returning fallbacks
- Editor scripts use synchronous string retrieval (no async/await needed)

## Adding New Strings

When adding new user-facing strings to CADET:

1. **Using CSV (Recommended):**
   - Add a new row to `CADET_Localization.csv` with the key and English value
   - Import the CSV into Unity using the "Import CSV" option in the Localization Tables window
   - Use the key in code: `CadetLocalization.GetString("Your.Key.Here")`

2. **Manual Entry:**
   - Add the string entry to the CADET String Table Collection in Unity Editor
   - Use the key in code: `CadetLocalization.GetString("Your.Key.Here")`

3. **Naming Convention:**
   - Always follow: `Window.{WindowName}.{Category}.{Item}`

## CSV Workflow Benefits

Using CSV for localization provides several advantages:

- **Easy editing**: Edit translations in spreadsheet applications (Excel, Google Sheets, etc.)
- **Version control friendly**: CSV files are text-based and work well with Git
- **Bulk updates**: Easily add/update multiple strings at once
- **Collaboration**: Translators can work in familiar spreadsheet tools
- **Backup**: CSV files serve as a backup of all your localization strings

