// Answers `onephylogeny sources` from made-up data, so its test runs offline. Any other request is refused.
// Load it with: NODE_OPTIONS="--import ./fixtures/sources/offline-sources.mjs"
// FAKE_SOURCES_FAILING, comma-separated, names services to fail (see FAKE_SERVICES in fake-services.mjs).
import { fakeSourcesFetch } from './fake-services.mjs'

globalThis.fetch = fakeSourcesFetch({ failing: (process.env.FAKE_SOURCES_FAILING ?? '').split(',').filter(Boolean) })
