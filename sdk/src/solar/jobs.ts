export const DEFAULT_SOLAR_STACK_PERCENT = 35
export const DEFAULT_SOLAR_REFERENCE_PERCENT = 10

export interface SolarPssConfig {
  pythonBin: string
  pssSourcePath: string
  stackPercent: number
  referenceFramePercent: number
  debayering: 'Force Bayer GRBG'
  debayerMethod: 'Edge Aware'
  stabilizationMode: 'Surface'
}

export interface SolarPythonConfig {
  modulePath: string
}

export interface SolarProcessJob {
  inputPath: string
  outputRootDir: string
  python: SolarPythonConfig
  pss: SolarPssConfig
}

export interface SolarOutputLayout {
  jobRootDir: string
  sourceDir: string
  stackedDir: string
  finalDir: string
  reviewDir: string
  metadataPath: string
}

export interface SolarProcessResult {
  layout: SolarOutputLayout
  sourceVideoPath: string
  sourceCompanionPaths: string[]
  stackedTiffPath: string
  grayscaleNaturalPath: string
  grayscaleFinalPath: string
  presentationMonoPath: string
  presentationArtisticGoldPath: string
  metadataPath: string
}
