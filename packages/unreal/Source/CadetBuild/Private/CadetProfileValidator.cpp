#include "CadetProfileValidator.h"

#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
    const TArray<FString>& GetRequiredTopLevelKeys()
    {
        static const TArray<FString> Keys = {
            TEXT("profileName"),
            TEXT("platform"),
            TEXT("os"),
            TEXT("bundleId")
        };
        return Keys;
    }

    const TArray<FString>& GetPlatformBlockNames()
    {
        static const TArray<FString> Names = {
            TEXT("unity"),
            TEXT("unreal"),
            TEXT("steam"),
            TEXT("epic")
        };
        return Names;
    }

    /** Required keys inside a platform block, from the schema. Empty when the block has none. */
    const TArray<FString>& GetRequiredBlockKeys(const FString& BlockName)
    {
        static const TArray<FString> UnityKeys = {
            TEXT("editorPath"), TEXT("projectPath"), TEXT("buildOutputPath"), TEXT("projectName")
        };
        static const TArray<FString> UnrealKeys = {
            TEXT("engineRoot"), TEXT("projectPath"), TEXT("buildOutputPath"), TEXT("projectName"),
            TEXT("buildConfiguration")
        };
        static const TArray<FString> SteamKeys = {
            TEXT("appId")
        };
        static const TArray<FString> EpicKeys = {
            TEXT("productId"), TEXT("organizationId"), TEXT("artifactId"), TEXT("sandboxId"),
            TEXT("buildPatchToolPath")
        };
        static const TArray<FString> NoKeys;

        if (BlockName == TEXT("unity"))
        {
            return UnityKeys;
        }
        if (BlockName == TEXT("unreal"))
        {
            return UnrealKeys;
        }
        if (BlockName == TEXT("steam"))
        {
            return SteamKeys;
        }
        if (BlockName == TEXT("epic"))
        {
            return EpicKeys;
        }
        return NoKeys;
    }

    bool HasNonEmptyString(const TSharedPtr<FJsonObject>& Object, const FString& Key)
    {
        FString Value;
        return Object->TryGetStringField(Key, Value) && !Value.IsEmpty();
    }
}

FString FCadetProfileValidationResult::GetErrorText() const
{
    return FString::Join(Errors, TEXT(", "));
}

namespace CadetProfileValidation
{
    bool ValidateDocument(const TSharedPtr<FJsonObject>& Document, FCadetProfileValidationResult& OutResult)
    {
        OutResult.Errors.Reset();

        if (!Document.IsValid())
        {
            OutResult.Errors.Add(TEXT("json"));
            return false;
        }

        for (const FString& Key : GetRequiredTopLevelKeys())
        {
            if (!HasNonEmptyString(Document, Key))
            {
                OutResult.Errors.Add(Key);
            }
        }

        const bool bHasUnity = Document->HasTypedField<EJson::Object>(TEXT("unity"));
        const bool bHasUnreal = Document->HasTypedField<EJson::Object>(TEXT("unreal"));
        if (!bHasUnity && !bHasUnreal)
        {
            // The schema accepts either engine block, never neither.
            OutResult.Errors.Add(TEXT("unity|unreal"));
        }

        for (const FString& BlockName : GetPlatformBlockNames())
        {
            const TSharedPtr<FJsonObject>* Block = nullptr;
            if (!Document->TryGetObjectField(BlockName, Block) || Block == nullptr || !Block->IsValid())
            {
                continue;
            }

            for (const FString& Key : GetRequiredBlockKeys(BlockName))
            {
                if (!HasNonEmptyString(*Block, Key))
                {
                    OutResult.Errors.Add(FString::Printf(TEXT("%s.%s"), *BlockName, *Key));
                }
            }
        }

        return OutResult.IsValid();
    }

    bool ValidateJsonText(const FString& JsonText, FCadetProfileValidationResult& OutResult)
    {
        OutResult.Errors.Reset();

        TSharedPtr<FJsonObject> Document;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonText);
        if (!FJsonSerializer::Deserialize(Reader, Document) || !Document.IsValid())
        {
            OutResult.Errors.Add(TEXT("json"));
            return false;
        }

        return ValidateDocument(Document, OutResult);
    }
}
