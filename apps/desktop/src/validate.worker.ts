import { leaveOneBlockOut, leaveOneGroupOut, type ValidationInput } from '@captiveorigins/onephylogeny-core'

self.onmessage = (e: MessageEvent<ValidationInput>) => {
  self.postMessage({ blocks: leaveOneBlockOut(e.data), groups: leaveOneGroupOut(e.data) })
}
