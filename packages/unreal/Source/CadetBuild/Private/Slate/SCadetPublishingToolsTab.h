#pragma once

#include <CoreMinimal.h>
#include <Widgets/SCompoundWidget.h>

class SCadetPublishingToolsPanel;

/**
 * Dockable tab for CADET Publishing Tools
 * Allows users to configure dependencies and platform credentials
 */
class SCadetPublishingToolsTab : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SCadetPublishingToolsTab) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	TSharedPtr<SCadetPublishingToolsPanel> PublishingToolsPanel;
};
