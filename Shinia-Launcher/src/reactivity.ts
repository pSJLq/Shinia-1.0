import { SDK } from '@somnia-chain/reactivity'
import { createPublicClient, http, webSocket, defineChain } from 'viem'

const somniaWithWs = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  network: 'somnia-testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://dream-rpc.somnia.network/'],
      webSocket: ['wss://dream-rpc.somnia.network/ws'],
    },
    public: {
      http: ['https://dream-rpc.somnia.network/'],
      webSocket: ['wss://dream-rpc.somnia.network/ws'],
    },
  },
})

export const publicClient = createPublicClient({
  chain: somniaWithWs,
  transport: http('https://dream-rpc.somnia.network/', {
    fetchOptions: { cache: 'no-store' },
  }),
})

export const wsPublicClient = createPublicClient({
  chain: somniaWithWs,
  transport: webSocket('wss://dream-rpc.somnia.network/ws'),
})

const sdk = new SDK({ public: wsPublicClient })

export async function subscribeToContract(
  contractAddress: `0x${string}`,
  onData: () => void
): Promise<{ unsubscribe: () => void } | null> {
  try {
    const sub = await sdk.subscribe({
      ethCalls: [],
      eventContractSources: [contractAddress],
      onData: () => onData(),
      onError: (e) => console.error('Reactivity error:', e),
    })
    if (sub instanceof Error) {
      console.error('Reactivity subscribe failed:', sub.message)
      return null
    }
    console.log('✅ Reactivity subscribed OK')
    return sub
  } catch (e) {
    console.error('Reactivity subscribe error:', e)
    return null
  }
}