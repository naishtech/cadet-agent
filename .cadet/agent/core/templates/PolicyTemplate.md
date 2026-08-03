# Policy: <slot id="title"/>

<slot id="summary" note="repository-specific policy overlay"/>

## Repository Context
- Repository or team name: <slot id="repositoryName"/>
- Applies when: <slot id="appliesWhen"/>
- Planning artifact directory: <slot id="planningArtifactDirectory"/>
- Shared-code location: <slot id="sharedCodeLocation"/>
- Other important repository paths: <slot id="otherPaths"/>

## Repository Conventions
- Default planning directory: <slot id="defaultPlanningDirectory"/>
- Shared infrastructure location and extraction rules: <slot id="sharedInfrastructureRules"/>
- Architecture or service-binding conventions: <slot id="architectureConventions"/>
- Naming, tagging, layer, scene, or asset conventions: <slot id="namingConventions"/>
- Configuration and ScriptableObject conventions: <slot id="configurationConventions"/>
- Logging and diagnostics conventions: <slot id="loggingConventions"/>
- Persistence, prefs, or save-schema conventions: <slot id="persistenceConventions"/>

## Localization Conventions
- Localization helpers, table sources, and fallback expectations: <slot id="localizationHelpers"/>
- Locale synchronization, key-ordering, and font regeneration rules: <slot id="localeRules"/>

## Delivery And Support Rules
- Build, CI, or release-tool recommendations: <slot id="deliveryRules"/>
- Attribution, credits, or legal notice requirements: <slot id="legalRequirements"/>
- Escalation or support-channel guidance: <slot id="supportGuidance"/>
- Additional ship or release gates: <slot id="releaseGates"/>
