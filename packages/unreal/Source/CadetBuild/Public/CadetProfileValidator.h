#pragma once

#include "CoreMinimal.h"

class FJsonObject;

/**
 * Checks a profile document against the fields that
 * packages/cli/cadet-profile.schema.json marks required.
 *
 * Not a JSON-Schema engine. It repeats the rules that packages/cli/test/validate-profiles.mjs
 * applies to the shipped fixtures, so a profile the plugin hands to the CLI cannot be
 * missing a field the CLI needs. The rules are:
 *   - profileName, platform, os, bundleId at the top level;
 *   - at least one of unity or unreal;
 *   - the required keys inside each platform block that is present.
 *
 * Every error names the field, so a caller can say which one is wrong.
 */
struct FCadetProfileValidationResult
{
    /** Field paths, e.g. "bundleId" or "unreal.engineRoot". Empty when valid. */
    TArray<FString> Errors;

    bool IsValid() const { return Errors.Num() == 0; }

    /** Field paths joined for display, e.g. "bundleId, unreal.engineRoot". */
    FString GetErrorText() const;
};

namespace CadetProfileValidation
{
    /** Validate a parsed document. A null document is reported as a parse error. */
    bool ValidateDocument(const TSharedPtr<FJsonObject>& Document, FCadetProfileValidationResult& OutResult);

    /** Parse, then validate. Unreadable JSON is reported as "json". */
    bool ValidateJsonText(const FString& JsonText, FCadetProfileValidationResult& OutResult);
}
