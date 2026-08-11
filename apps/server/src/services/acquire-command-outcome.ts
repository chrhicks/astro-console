import { Schema } from 'effect'
import {
  AcquireCommandResponse,
  CameraCommandResponse,
} from '@astro-console/protocol'

export const AcquireCommandOutcome = Schema.TaggedUnion({
  ReadOnly: { response: AcquireCommandResponse.cases.Unavailable },
  AcquireAccepted: { response: AcquireCommandResponse.cases.Accepted },
  AcquireRejected: { response: AcquireCommandResponse.cases.Rejected },
  AcquireUnavailable: { response: AcquireCommandResponse.cases.Unavailable },
  CameraAccepted: {
    response: Schema.Union([
      CameraCommandResponse.cases.Accepted,
      CameraCommandResponse.cases.Completed,
    ]),
  },
  CameraRejected: { response: CameraCommandResponse.cases.Rejected },
  CameraUnavailable: {
    response: Schema.Union([
      CameraCommandResponse.cases.Rejected,
      CameraCommandResponse.cases.Unavailable,
    ]),
  },
})
