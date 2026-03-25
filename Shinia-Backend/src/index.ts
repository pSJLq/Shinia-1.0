import express from 'express'
import cors from 'cors'
import * as dotenv from 'dotenv'
import { spawn, ChildProcess } from 'child_process'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  defineChain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

dotenv.config()

const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  network: 'somnia-testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://dream-rpc.somnia.network/'] },
    public:  { http: ['https://dream-rpc.somnia.network/'] },
  },
})

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS as `0x${string}`
const PRIVATE_KEY      = process.env.OWNER_PRIVATE_KEY as `0x${string}`

const GAME_SERVER_PATH = process.env.GAME_SERVER_PATH || '/opt/shinia-game/Shinia/Binaries/Linux/Shinia'
const GAME_MAP         = process.env.GAME_MAP || '/Game/Game/Maps/GameMap'

const PORT_RANGE_START = 7777
const PORT_RANGE_END   = 7850

interface ServerInstance {
  port:      number
  pid:       number
  process:   ChildProcess
  startedAt: number
}
const runningServers = new Map<number, ServerInstance>()

function getAvailablePort(): number | null {
  const usedPorts = new Set([...runningServers.values()].map(s => s.port))
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!usedPorts.has(p)) return p
  }
  return null
}

const CONTRACT_ABI = parseAbi([
  'function onPlayerDeath(uint256 lobbyId, address victim, address killer) external',
  'function endMatch(uint256 lobbyId, uint8 winningTeam) external',
  'function getLobbyInfo(uint256 lobbyId) external view returns (address creator, uint256 costPerLife, uint8 maxPlayers, uint256 playerCount, bool active, bool started)',
  'function getLobbyPlayers(uint256 lobbyId) external view returns (address[], uint8[])',
  'function lobbyCount() external view returns (uint256)',
  'function playerNicknames(address) external view returns (string)',
  'function inMatch(address) external view returns (bool)',
  'function canRespawn(uint256 lobbyId, address player) external view returns (bool)',
  'function playerKills(uint256, address) external view returns (uint256)',
  'function playerDeaths(uint256, address) external view returns (uint256)',
])

const account = privateKeyToAccount(PRIVATE_KEY)

const walletClient = createWalletClient({
  account,
  chain: somniaTestnet,
  transport: http('https://dream-rpc.somnia.network/'),
})

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http('https://dream-rpc.somnia.network/'),
})

const app = express()
app.use(cors())
app.use(express.json())


// ─── HEALTH ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    contract: CONTRACT_ADDRESS,
    owner: account.address,
    runningServers: [...runningServers.entries()].map(([lobbyId, s]) => ({
      lobbyId,
      port: s.port,
      pid:  s.pid,
      uptime: Math.floor((Date.now() - s.startedAt) / 1000) + 's',
    })),
  })
})


// ─── SERVER MANAGEMENT ───────────────────────────────────────────────────────

app.post('/start-match-server', async (req, res) => {
  try {
    const { lobbyId } = req.body
    if (lobbyId === undefined) return res.status(400).json({ error: 'lobbyId required' })

    const id = Number(lobbyId)

    if (runningServers.has(id)) {
      const existing = runningServers.get(id)!
      console.log(`[SERVER] lobby=${id} already running on port ${existing.port}`)
      return res.json({ success: true, port: existing.port, alreadyRunning: true })
    }

    const port = getAvailablePort()
    if (!port) return res.status(503).json({ error: 'No available ports (max servers reached)' })

    console.log(`[SERVER] Starting lobby=${id} on port=${port}`)

    const args = [
      GAME_MAP,
      `-server`,
      `-port=${port}`,
      `-lobbyId=${id}`,
      `-log`,
      `-logfile=/tmp/shinia-lobby${id}.log`,
      `-nosteam`,
      `-unattended`,
      `-nullrhi`,
      `-nopause`,
    ]

    const proc = spawn(GAME_SERVER_PATH, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      uid: 1000, // shinia user - UE5 refuses to run as root
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: '/run/user/1000',
        HOME: '/home/shinia',
      },
    })

    proc.stdout?.on('data', (d) => console.log(`[SRV:${id}] ${d.toString().trim()}`))
    proc.stderr?.on('data', (d) => console.error(`[SRV:${id}] ${d.toString().trim()}`))
    proc.on('exit', (code) => {
      console.log(`[SERVER] lobby=${id} process exited code=${code}`)
      runningServers.delete(id)
    })

    runningServers.set(id, { port, pid: proc.pid!, process: proc, startedAt: Date.now() })

    await new Promise(r => setTimeout(r, 3000))

    console.log(`[SERVER] lobby=${id} ready on port=${port} pid=${proc.pid}`)
    res.json({ success: true, port })
  } catch (e: any) {
    console.error('[SERVER] start error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/lobby-port', (req, res) => {
  const { lobbyId } = req.query
  if (!lobbyId) return res.status(400).json({ error: 'lobbyId required' })

  const id = Number(lobbyId)
  const server = runningServers.get(id)
  if (!server) return res.status(404).json({ error: 'Server not running for this lobby' })

  res.json({ port: server.port })
})

app.post('/stop-match-server', (req, res) => {
  const { lobbyId } = req.body
  if (lobbyId === undefined) return res.status(400).json({ error: 'lobbyId required' })

  const id = Number(lobbyId)
  const server = runningServers.get(id)
  if (!server) return res.json({ success: true, message: 'Not running' })

  console.log(`[SERVER] Stopping lobby=${id} pid=${server.pid}`)
  server.process.kill('SIGTERM')
  runningServers.delete(id)
  res.json({ success: true })
})


// ─── BLOCKCHAIN ───────────────────────────────────────────────────────────────

app.post('/player-death', async (req, res) => {
  try {
    const { lobbyId, victim, killer } = req.body
    if (lobbyId === undefined) return res.status(400).json({ error: 'lobbyId required' })
    if (!victim || !killer)    return res.status(400).json({ error: 'victim and killer required' })

    console.log(`[DEATH] lobby=${lobbyId} victim=${victim} killer=${killer}`)

    const hash = await walletClient.writeContract({
      chain: somniaTestnet,
      account,
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'onPlayerDeath',
      args: [BigInt(lobbyId), victim as `0x${string}`, killer as `0x${string}`],
    })

    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`[DEATH] tx: ${hash}`)
    res.json({ success: true, hash })
  } catch (e: any) {
    console.error('[DEATH] error:', e.message)
    res.status(500).json({ error: e.message })
  }
})


app.post('/pay-respawn', async (req, res) => {
  try {
    const { lobbyId, wallet } = req.body
    if (lobbyId === undefined || !wallet) {
      return res.status(400).json({ error: 'lobbyId and wallet required' })
    }

    const [canRespawn, lobbyInfo] = await Promise.all([
      publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'canRespawn',
        args: [BigInt(lobbyId), wallet as `0x${string}`],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'getLobbyInfo',
        args: [BigInt(lobbyId)],
      }) as Promise<[string, bigint, number, bigint, boolean, boolean]>,
    ])

    const costPerLife = lobbyInfo[1]
    res.json({ success: canRespawn, canRespawn, costPerLife: costPerLife.toString() })
  } catch (e: any) {
    console.error('[RESPAWN] error:', e.message)
    res.status(500).json({ error: e.message })
  }
})


app.post('/end-match', async (req, res) => {
  try {
    const { lobbyId } = req.body
    if (lobbyId === undefined) return res.status(400).json({ error: 'lobbyId required' })

    console.log(`[END] lobby=${lobbyId}`)

    const [players, teams] = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getLobbyPlayers',
      args: [BigInt(lobbyId)],
    }) as [string[], number[]]

    let team1Kills = 0n, team2Kills = 0n

    for (let i = 0; i < players.length; i++) {
      const kills = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'playerKills',
        args: [BigInt(lobbyId), players[i] as `0x${string}`],
      }) as bigint

      if (teams[i] === 1)      team1Kills += kills
      else if (teams[i] === 2) team2Kills += kills
    }

    const winningTeam = team2Kills > team1Kills ? 2 : 1

    const hash = await walletClient.writeContract({
      chain: somniaTestnet,
      account,
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'endMatch',
      args: [BigInt(lobbyId), winningTeam],
    })

    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`[END] tx: ${hash} winner=team${winningTeam}`)

    const server = runningServers.get(Number(lobbyId))
    if (server) {
      server.process.kill('SIGTERM')
      runningServers.delete(Number(lobbyId))
      console.log(`[END] Game server for lobby=${lobbyId} stopped`)
    }

    res.json({ success: true, hash, winningTeam })
  } catch (e: any) {
    console.error('[END] error:', e.message)
    res.status(500).json({ error: e.message })
  }
})


app.get('/lobbies', async (_req, res) => {
  try {
    const count = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'lobbyCount',
    }) as bigint

    const lobbies = []
    for (let i = 0; i < Number(count); i++) {
      try {
        const [_creator, costPerLife, maxPlayers, playerCount, active, started] =
          await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getLobbyInfo',
            args: [BigInt(i)],
          }) as [string, bigint, number, bigint, boolean, boolean]

        if (active && !started) {
          lobbies.push({ id: i, costPerLife: costPerLife.toString(), maxPlayers, playerCount: Number(playerCount) })
        }
      } catch { /* */ }
    }

    res.json({ lobbies })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})


app.get('/nickname', async (req, res) => {
  try {
    const { wallet } = req.query
    if (!wallet) return res.status(400).json({ error: 'wallet required' })

    const nick = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'playerNicknames',
      args: [wallet as `0x${string}`],
    }) as string

    const w = wallet as string
    res.json({ nickname: nick || `${w.slice(0, 6)}...${w.slice(-4)}` })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})


app.get('/match-results', async (req, res) => {
  try {
    const { lobbyId } = req.query
    if (!lobbyId) return res.status(400).json({ error: 'lobbyId required' })

    const [players, teams] = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getLobbyPlayers',
      args: [BigInt(lobbyId as string)],
    }) as [string[], number[]]

    const latestBlock = await publicClient.getBlockNumber()
    const fromBlock   = latestBlock > 5000n ? latestBlock - 5000n : 0n

    const logs = await publicClient.getLogs({
      address: CONTRACT_ADDRESS,
      event: parseAbiItem(
        'event GlobalStatsUpdated(address indexed player, uint256 killsDelta, uint256 deathsDelta, uint256 winDelta, uint256 lossDelta, uint256 earnedDelta, uint256 timestamp)'
      ),
      fromBlock,
      toBlock: latestBlock,
    })

    const earnedMap: Record<string, bigint> = {}
    for (const log of logs) {
      if (log.args.player) earnedMap[log.args.player.toLowerCase()] = log.args.earnedDelta ?? 0n
    }

    const results = await Promise.all(players.map(async (addr, i) => {
      const [kills, deaths, nickname] = await Promise.all([
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'playerKills',   args: [BigInt(lobbyId as string), addr as `0x${string}`] }) as Promise<bigint>,
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'playerDeaths',  args: [BigInt(lobbyId as string), addr as `0x${string}`] }) as Promise<bigint>,
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'playerNicknames', args: [addr as `0x${string}`] }) as Promise<string>,
      ])
      return {
        wallet:   addr,
        nickname: nickname || `${addr.slice(0, 6)}...${addr.slice(-4)}`,
        kills:    Number(kills),
        deaths:   Number(deaths),
        earned:   (earnedMap[addr.toLowerCase()] ?? 0n).toString(),
        team:     teams[i],
      }
    }))

    let score1 = 0, score2 = 0
    for (const r of results) {
      if (r.team === 1) score1 += r.kills
      else if (r.team === 2) score2 += r.kills
    }

    res.json({ results, score1, score2 })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})


app.get('/hud-stats', async (req, res) => {
  try {
    const { lobbyId } = req.query
    if (!lobbyId) return res.status(400).json({ error: 'lobbyId required' })

    const [players, teams] = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getLobbyPlayers',
      args: [BigInt(lobbyId as string)],
    }) as [string[], number[]]

    const stats = await Promise.all(players.map(async (addr, i) => {
      const [kills, deaths] = await Promise.all([
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'playerKills',  args: [BigInt(lobbyId as string), addr as `0x${string}`] }) as Promise<bigint>,
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'playerDeaths', args: [BigInt(lobbyId as string), addr as `0x${string}`] }) as Promise<bigint>,
      ])
      return { wallet: addr, kills: Number(kills), deaths: Number(deaths), team: teams[i] }
    }))

    let score1 = 0, score2 = 0
    for (const s of stats) {
      if (s.team === 1) score1 += s.kills
      else if (s.team === 2) score2 += s.kills
    }

    res.json({ stats, score1, score2 })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})


// ─── AUTH TOKENS ─────────────────────────────────────────────────────────────

const authTokens = new Map<string, { wallet: string; lobbyId: number; expires: number }>()

app.post('/auth-token', async (req, res) => {
  try {
    const { wallet, lobbyId } = req.body
    if (!wallet || lobbyId === undefined) return res.status(400).json({ error: 'wallet and lobbyId required' })

    const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
    authTokens.set(token, { wallet, lobbyId: Number(lobbyId), expires: Date.now() + 60_000 })

    res.json({ token })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'token required' })

    const data = authTokens.get(token)
    if (!data) return res.status(401).json({ error: 'Invalid token' })
    if (Date.now() > data.expires) {
      authTokens.delete(token)
      return res.status(401).json({ error: 'Token expired' })
    }

    authTokens.delete(token)
    res.json({ valid: true, wallet: data.wallet, lobbyId: data.lobbyId })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})


// ─── START ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Shinia Backend running on port ${PORT}`)
  console.log(`Owner:    ${account.address}`)
  console.log(`Contract: ${CONTRACT_ADDRESS}`)
  console.log(`Game:     ${GAME_SERVER_PATH}`)
  console.log(`Ports:    ${PORT_RANGE_START}-${PORT_RANGE_END}`)
})
