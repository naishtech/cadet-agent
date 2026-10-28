#include "Slate/SCadetPublishingToolsTab.h"
#include "SCadetPublishingToolsPanel.h"
#include "Widgets/Layout/SBorder.h"

#define LOCTEXT_NAMESPACE "SCadetPublishingToolsTab"

void SCadetPublishingToolsTab::Construct(const FArguments& InArgs)
{
	ChildSlot
	[
		SNew(SBorder)
		.Padding(0.0f)
		[
			SAssignNew(PublishingToolsPanel, SCadetPublishingToolsPanel)
		]
	];
}

#undef LOCTEXT_NAMESPACE
