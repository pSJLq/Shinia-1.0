import { createConfig } from '@0xsequence/connect'
import { http } from 'viem'
import { defineChain } from 'viem'

export const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  network: 'somnia-testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://dream-rpc.somnia.network/'] },
    public: { http: ['https://dream-rpc.somnia.network/'] },
  },
})

export const sequenceConfig = createConfig('waas', {
  projectAccessKey: 'AQAAAAAAALy5mR-WjtoOxXt3tZzndcFFqr4',
  waasConfigKey: 'eyJwcm9qZWN0SWQiOjQ4MzEzLCJycGNTZXJ2ZXIiOiJodHRwczovL3dhYXMuc2VxdWVuY2UuYXBwIn0=',
  defaultChainId: 50312,
  chainIds: [50312],
  appName: 'Shinia',
  signIn: { projectName: 'Shinia' },
  defaultTheme: 'dark',
  position: 'center',
  email: true,
  metaMask: false,
  coinbase: false,
  wagmiConfig: {
    multiInjectedProviderDiscovery: false,
    transports: {
      50312: http('https://dream-rpc.somnia.network/'),
    },
  },
})