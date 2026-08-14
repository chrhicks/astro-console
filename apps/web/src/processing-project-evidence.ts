import {
  OpenedProcessingProject,
  ProcessingProjectEvidence,
} from '@astro-console/protocol'

export const latestSavedStackingMasterAssetIdFromCompleteEvidence = (
  project: typeof OpenedProcessingProject.Type,
  evidence: typeof ProcessingProjectEvidence.Type | undefined,
) => {
  if (
    evidence === undefined ||
    evidence.projectId !== project.projectId ||
    evidence.nextAttemptId !== undefined
  )
    return undefined

  const savedStackingMasterAssetIds = new Set(
    evidence.attempts.flatMap((attempt) =>
      attempt.evidence._tag === 'Stacking' &&
      attempt.evidence.savedMasterAssetId !== undefined
        ? [attempt.evidence.savedMasterAssetId]
        : [],
    ),
  )
  return project.savedAssetIds
    .toReversed()
    .find((assetId) => savedStackingMasterAssetIds.has(assetId))
}
