import { createRoot } from 'react-dom/client'
import '@captiveorigins/onephylogeny-react/styles.css'
import './app.css'
import { App } from './App'
import { isMac, type Platform } from './platform'
import { createPreviewPlatform } from './platform-preview'

async function start() {
  const platform: Platform = isMac() ? await (await import('./platform-mac')).createMacPlatform() : createPreviewPlatform()
  createRoot(document.getElementById('root')!).render(<App platform={platform} />)
}
void start()
