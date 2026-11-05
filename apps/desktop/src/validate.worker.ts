import { fullValidation, type ValidationInput } from '@captiveorigins/onephylogeny-core'

self.onmessage = (e: MessageEvent<ValidationInput>) => {
  self.postMessage(fullValidation(e.data))
}
