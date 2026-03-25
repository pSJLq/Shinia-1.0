import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
import '@fontsource/orbitron/400.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/orbitron/900.css'
import '@fontsource/share-tech-mono/400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SequenceConnect } from '@0xsequence/connect'
import { sequenceConfig } from './sequence.config'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SequenceConnect config={sequenceConfig}>
      <App />
    </SequenceConnect>
  </StrictMode>,
)