import { fullValidation, type ValidationInput } from '@extantape/onephylogeny-core'

self.onmessage = (e: MessageEvent<ValidationInput>) => {
  self.postMessage(fullValidation(e.data))
}
