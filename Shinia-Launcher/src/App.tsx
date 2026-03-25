import { useOpenConnectModal } from '@0xsequence/connect'
import { useAccount, useDisconnect, useWalletClient } from 'wagmi'
import { useState, useEffect, useCallback, useRef } from 'react'
import { parseAbi, parseAbiItem, formatEther, decodeEventLog, parseEther } from 'viem'
import './App.css'
import { publicClient, subscribeToContract } from './reactivity'
import { somniaTestnet } from './sequence.config'

const QR_API = (addr: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${addr}`

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}`
const BACKEND_URL = 'https://shinia.mom/api'
const ADMIN_ADDRESS = '0xfB4513B7DF22988bd65429cC8eB9966b72dd7E70'

const CONTRACT_ABI = parseAbi([
  'function setNickname(string calldata nickname) external',
  'function getNickname(address player) external view returns (string memory)',
  'function playerNicknames(address) external view returns (string memory)',
  'function nicknameOwner(string) external view returns (address)',
  'function getLeaderboard(uint256 offset, uint256 limit) external view returns (address[], uint256[], uint256[], uint256[], uint256[], uint256[])',
  'function getPlayersCount() external view returns (uint256)',
  'function createLobby(uint256 costPerLife, uint8 maxPlayers) external returns (uint256)',
  'function joinLobby(uint256 lobbyId, uint8 team) external payable',
  'function setReady(uint256 lobbyId) external',
  'function setUnready(uint256 lobbyId) external',
  'function kickPlayer(uint256 lobbyId, address player) external',
  'function leaveLobby(uint256 lobbyId) external',
  'function getLobbyInfo(uint256 lobbyId) external view returns (address, uint256, uint8, uint256, bool, bool)',
  'function getLobbyPlayers(uint256 lobbyId) external view returns (address[], uint8[])',
  'function isReady(uint256, address) external view returns (bool)',
  'function isKicked(uint256, address) external view returns (bool)',
  'function playerCurrentLobby(address) external view returns (int256)',
  'function lobbyCount() external view returns (uint256)',
  'event GlobalStatsUpdated(address indexed player, uint256 killsDelta, uint256 deathsDelta, uint256 winDelta, uint256 lossDelta, uint256 earnedDelta, uint256 timestamp)',
  'event LobbyCreated(uint256 indexed lobbyId, address indexed creator, uint256 costPerLife, uint8 maxPlayers)',
  'event PlayerJoined(uint256 indexed lobbyId, address indexed player, uint8 team)',
  'event PlayerReady(uint256 indexed lobbyId, address indexed player)',
  'event PlayerUnready(uint256 indexed lobbyId, address indexed player)',
  'event PlayerKicked(uint256 indexed lobbyId, address indexed player, address indexed kickedBy)',
  'event LobbyStarted(uint256 indexed lobbyId)',
  'event NicknameSet(address indexed player, string nickname)',
  'function disbandLobby(uint256 lobbyId) external',
  'event LobbyDisbanded(uint256 indexed lobbyId, address indexed creator)',
  'function payRespawn(uint256 lobbyId) external payable',
  'event PlayerRespawned(uint256 indexed lobbyId, address indexed player)',
])

type Period = 'all' | 'month' | 'week'
type LeaderboardEntry = {
  address: string; nickname: string; kills: number; deaths: number
  wins: number; losses: number; earned: bigint; kd: string
}
type ToastState = { msg: string; ok: boolean } | null

type LobbyPlayer = {
  address: string
  nickname: string
  team: number
  ready: boolean
}

type LobbyData = {
  lobbyId: number
  creator: string
  costPerLife: bigint
  maxPlayers: number
  players: LobbyPlayer[]
  active: boolean
  started: boolean
}

type ActiveLobby = {
  id: number
  creator: string
  costPerLife: bigint
  maxPlayers: number
  playerCount: number
  active: boolean
  started: boolean
}

const REACTIVITY_DELAY = 200

function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null
  return (
    <div className={toast.ok ? 'toast toast-ok' : 'toast toast-err'}>
      {toast.ok ? '✓' : '✕'} {toast.msg}
    </div>
  )
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [period, setPeriod] = useState<Period>('all')
  const [loadingLB, setLoadingLB] = useState(true)
  const [search, setSearch] = useState('')

  const periodRef = useRef(period)
  useEffect(() => { periodRef.current = period }, [period])

  const loadLeaderboard = useCallback(async (p: Period) => {
    setLoadingLB(true)
    try {
      const now = Math.floor(Date.now() / 1000)
      const thresholds: Record<Period, number> = {
        all: 0, month: now - 30 * 24 * 3600, week: now - 7 * 24 * 3600,
      }
      const threshold = thresholds[p]

      if (p === 'all') {
        const count = await publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getPlayersCount',
        }) as bigint
        if (count === 0n) { setEntries([]); setLoadingLB(false); return }
        const [players, kills, deaths, wins, losses, earned] =
          await publicClient.readContract({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
            functionName: 'getLeaderboard', args: [0n, count],
          }) as [string[], bigint[], bigint[], bigint[], bigint[], bigint[]]
        const nicknames = await Promise.all(
          players.map(addr =>
            publicClient.readContract({
              address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
              functionName: 'playerNicknames', args: [addr as `0x${string}`],
            }).catch(() => '') as Promise<string>
          )
        )
        const result: LeaderboardEntry[] = players.map((addr, i) => ({
          address: addr,
          nickname: nicknames[i] || `${addr.slice(0, 6)}...${addr.slice(-4)}`,
          kills: Number(kills[i]), deaths: Number(deaths[i]),
          wins: Number(wins[i]), losses: Number(losses[i]), earned: earned[i],
          kd: deaths[i] === 0n ? kills[i].toString()
            : (Number(kills[i]) / Number(deaths[i])).toFixed(2),
        }))
        result.sort((a, b) => (b.earned > a.earned ? 1 : -1))
        setEntries(result)
      } else {
        const latestBlock = await publicClient.getBlockNumber()
        const fromBlock = latestBlock > 1000n ? latestBlock - 1000n : 0n
        const logs = await publicClient.getLogs({
          address: CONTRACT_ADDRESS,
          event: parseAbiItem(
            'event GlobalStatsUpdated(address indexed player, uint256 killsDelta, uint256 deathsDelta, uint256 winDelta, uint256 lossDelta, uint256 earnedDelta, uint256 timestamp)'
          ),
          fromBlock, toBlock: latestBlock,
        })
        const stats: Record<string, { kills: bigint, deaths: bigint, wins: bigint, losses: bigint, earned: bigint }> = {}
        for (const log of logs) {
          const { args } = decodeEventLog({
            abi: CONTRACT_ABI, eventName: 'GlobalStatsUpdated',
            data: log.data, topics: log.topics,
          }) as { args: { player: string, killsDelta: bigint, deathsDelta: bigint, winDelta: bigint, lossDelta: bigint, earnedDelta: bigint, timestamp: bigint } }
          if (Number(args.timestamp) < threshold) continue
          const addr = args.player.toLowerCase()
          if (!stats[addr]) stats[addr] = { kills: 0n, deaths: 0n, wins: 0n, losses: 0n, earned: 0n }
          stats[addr].kills += args.killsDelta
          stats[addr].deaths += args.deathsDelta
          stats[addr].wins += args.winDelta
          stats[addr].losses += args.lossDelta
          stats[addr].earned += args.earnedDelta
        }
        const addrs = Object.keys(stats)
        if (addrs.length === 0) { setEntries([]); setLoadingLB(false); return }
        const nicknames = await Promise.all(
          addrs.map(addr =>
            publicClient.readContract({
              address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
              functionName: 'playerNicknames', args: [addr as `0x${string}`],
            }).catch(() => '') as Promise<string>
          )
        )
        const result: LeaderboardEntry[] = addrs.map((addr, i) => {
          const s = stats[addr]
          return {
            address: addr,
            nickname: nicknames[i] || `${addr.slice(0, 6)}...${addr.slice(-4)}`,
            kills: Number(s.kills), deaths: Number(s.deaths),
            wins: Number(s.wins), losses: Number(s.losses), earned: s.earned,
            kd: s.deaths === 0n ? s.kills.toString()
              : (Number(s.kills) / Number(s.deaths)).toFixed(2),
          }
        })
        result.sort((a, b) => (b.earned > a.earned ? 1 : -1))
        setEntries(result)
      }
    } catch (e) { console.error('Leaderboard error:', e) }
    setLoadingLB(false)
  }, [])

  useEffect(() => { loadLeaderboard(period) }, [period, loadLeaderboard])

  const loadLeaderboardRef = useRef(loadLeaderboard)
  useEffect(() => { loadLeaderboardRef.current = loadLeaderboard }, [loadLeaderboard])

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null
    let timer: ReturnType<typeof setTimeout>
    subscribeToContract(CONTRACT_ADDRESS, () => {
      clearTimeout(timer)
      timer = setTimeout(() => loadLeaderboardRef.current(periodRef.current), REACTIVITY_DELAY)
    }).then(s => { sub = s })
    return () => { sub?.unsubscribe(); clearTimeout(timer) }
  }, [])

  const periodLabel: Record<Period, string> = { all: 'ALL TIME', month: '1 MONTH', week: '1 WEEK' }
  const filtered = entries.filter(e => search === '' || e.nickname.toUpperCase().includes(search))

  return (
    <div className="leaderboard">
      <div className="lb-header">
        <h2>Leaderboard</h2>
        <div className="lb-filters">
          {(['all', 'month', 'week'] as Period[]).map(p => (
            <button key={p} className={period === p ? 'lb-filter active' : 'lb-filter'} onClick={() => setPeriod(p)}>
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>
      <input className="lb-search" type="text" placeholder="Search by callsign..."
        value={search} onChange={e => setSearch(e.target.value.toUpperCase())} />
      {loadingLB ? (
        <div className="empty-state">LOADING...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No data for this period</div>
      ) : (
        <table className="lb-table">
          <thead>
            <tr><th>#</th><th>OPERATOR</th><th>K / D</th><th>K/D RATIO</th><th>W / L</th><th>EARNED STT</th></tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={e.address} className={i === 0 ? 'lb-row-top' : 'lb-row'}>
                <td className="lb-rank">{i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</td>
                <td className="lb-nick">{e.nickname}</td>
                <td>{e.kills} / {e.deaths}</td>
                <td className="lb-kd">{e.kd}</td>
                <td>{e.wins} / {e.losses}</td>
                <td className="lb-earned">{parseFloat(formatEther(e.earned)).toFixed(4)} STT</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}


function LobbyList({
  onJoin,
  showToast,
  currentAddress,
}: {
  onJoin: (lobbyId: number) => void
  showToast: (msg: string, ok?: boolean) => void
  currentAddress: string
}) {
  const [lobbies, setLobbies] = useState<ActiveLobby[]>([])
  const [loading, setLoading] = useState(true)
  const { data: walletClient } = useWalletClient()

  const loadLobbies = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const count = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'lobbyCount',
      }) as bigint

      const result: ActiveLobby[] = []
      for (let i = 0; i < Number(count); i++) {
        const [creator, costPerLife, maxPlayers, playerCount, active, started] =
          await publicClient.readContract({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
            functionName: 'getLobbyInfo', args: [BigInt(i)],
          }) as [string, bigint, number, bigint, boolean, boolean]

        if (active && !started) {
          result.push({
            id: i, creator, costPerLife, maxPlayers,
            playerCount: Number(playerCount), active, started,
          })
        }
      }
      setLobbies(result)
    } catch (e) { console.error('LoadLobbies error:', e) }
    setLoading(false)
  }, [])

  useEffect(() => { loadLobbies(false) }, [loadLobbies])

  const loadLobbiesRef = useRef(loadLobbies)
  useEffect(() => { loadLobbiesRef.current = loadLobbies }, [loadLobbies])

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null
    let timer: ReturnType<typeof setTimeout>
    subscribeToContract(CONTRACT_ADDRESS, () => {
      clearTimeout(timer)
      timer = setTimeout(() => loadLobbiesRef.current(true), REACTIVITY_DELAY)
    }).then(s => { sub = s })
    return () => { sub?.unsubscribe(); clearTimeout(timer) }
  }, [])

  const handleJoin = async (lobby: ActiveLobby, team: 1 | 2) => {
    if (!walletClient || !currentAddress) { showToast('No wallet', false); return }

    const currentLobby = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'playerCurrentLobby', args: [currentAddress as `0x${string}`],
    }) as bigint

    if (currentLobby >= 0n) {
      showToast('You are already in a lobby. Leave it first.', false)
      return
    }

    const kicked = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'isKicked', args: [BigInt(lobby.id), currentAddress as `0x${string}`],
    }) as boolean

    if (kicked) {
      showToast('You have been kicked from this lobby', false)
      return
    }

    try {
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'joinLobby',
        args: [BigInt(lobby.id), team],
        value: lobby.costPerLife * 1n,
        chain: somniaTestnet,
        account: currentAddress as `0x${string}`,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showToast(`Joined lobby #${lobby.id}!`)
      onJoin(lobby.id)
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
  }

  return (
    <div className="lobby-list">
      <div className="lb-header">
        <h2>Active Sessions</h2>
      </div>
      {loading ? (
        <div className="empty-state">SCANNING...</div>
      ) : lobbies.length === 0 ? (
        <div className="empty-state">No active sessions detected</div>
      ) : (
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th><th>COMMANDER</th><th>COST/LIFE</th>
              <th>OPERATORS</th><th>JOIN TEAM 1</th><th>JOIN TEAM 2</th>
            </tr>
          </thead>
          <tbody>
            {lobbies.map(l => (
              <tr key={l.id} className="lb-row">
                <td className="lb-rank">#{l.id}</td>
                <td className="lb-nick">{`${l.creator.slice(0, 6)}...${l.creator.slice(-4)}`}</td>
                <td>{parseFloat(formatEther(l.costPerLife)).toFixed(4)} STT</td>
                <td>{l.playerCount} / {l.maxPlayers}</td>
                <td>
                  <button className="btn-join btn-team1" onClick={() => handleJoin(l, 1)}>
                    ▶ TEAM A
                  </button>
                </td>
                <td>
                  <button className="btn-join btn-team2" onClick={() => handleJoin(l, 2)}>
                    ▶ TEAM B
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}


function CreateLobby({
  showToast,
  onCreated,
}: {
  showToast: (msg: string, ok?: boolean) => void
  onCreated: (lobbyId: number) => void
}) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [costPerLife, setCostPerLife] = useState('0.01')
  const [maxPlayers, setMaxPlayers] = useState('10')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
  if (!address || !walletClient) { showToast('No wallet', false); return }

  const currentLobby = await publicClient.readContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
    functionName: 'playerCurrentLobby', args: [address],
  }) as bigint

  if (currentLobby >= 0n) {
    showToast(`You are already in lobby #${currentLobby}`, false)
    return
  }

  setLoading(true)
  try {
    const costWei = parseEther(costPerLife)

    const createHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'createLobby',
      args: [costWei, Number(maxPlayers)],
      chain: somniaTestnet, account: address,
    })
    await publicClient.waitForTransactionReceipt({ hash: createHash })

    const count = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'lobbyCount',
    }) as bigint
    const newLobbyId = Number(count) - 1

    const joinHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'joinLobby',
      args: [BigInt(newLobbyId), 1],
      value: costWei * 1n,
      chain: somniaTestnet, account: address,
    })
    await publicClient.waitForTransactionReceipt({ hash: joinHash })

    showToast(`Session deployed! Lobby #${newLobbyId}`)
    onCreated(newLobbyId)
  } catch (e: unknown) {
    showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
  }
  setLoading(false)
}

  return (
    <div className="create-lobby">
      <h2>Deploy Session</h2>
      <div className="form">
        <label>
          Cost per life (STT)
          <input type="number" value={costPerLife}
            onChange={e => setCostPerLife(e.target.value)} min="0.001" step="0.001" />
        </label>
        <label>
          Max operators
          <input type="number" value={maxPlayers}
            onChange={e => setMaxPlayers(e.target.value)} min="2" max="20" />
        </label>
        <button className="btn-create" onClick={handleCreate} disabled={loading}>
          {loading ? 'DEPLOYING...' : 'Deploy Session'}
        </button>
      </div>
    </div>
  )
}

// ─── Current Session (Staging) ───────────────────────────────────────────────

function CurrentSession({
  lobbyId,
  currentAddress,
  showToast,
  onLeft,
}: {
  lobbyId: number
  currentAddress: string
  showToast: (msg: string, ok?: boolean) => void
  onLeft: () => void
}) {
  const { data: walletClient } = useWalletClient()
  const [lobby, setLobby] = useState<LobbyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [gamePort, setGamePort] = useState<number | null>(null)
  const [startingServer, setStartingServer] = useState(false)

  const loadLobby = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [creator, costPerLife, maxPlayers, , active, started] =
        await publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
          functionName: 'getLobbyInfo', args: [BigInt(lobbyId)],
        }) as [string, bigint, number, bigint, boolean, boolean]

      const [playerAddrs, teams] = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'getLobbyPlayers', args: [BigInt(lobbyId)],
      }) as [string[], number[]]

      const players: LobbyPlayer[] = await Promise.all(
        playerAddrs.map(async (addr, i) => {
          const [nickname, ready] = await Promise.all([
            publicClient.readContract({
              address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
              functionName: 'playerNicknames', args: [addr as `0x${string}`],
            }).catch(() => '') as Promise<string>,
            publicClient.readContract({
              address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
              functionName: 'isReady', args: [BigInt(lobbyId), addr as `0x${string}`],
            }).catch(() => false) as Promise<boolean>,
          ])
          return {
            address: addr,
            nickname: nickname || `${addr.slice(0, 6)}...${addr.slice(-4)}`,
            team: teams[i],
            ready,
          }
        })
      )

      setLobby({ lobbyId, creator, costPerLife, maxPlayers, players, active, started })
    } catch (e) { console.error('LoadLobby error:', e) }
    setLoading(false)
  }, [lobbyId])

  useEffect(() => {
    if (!lobby?.started || gamePort !== null || startingServer) return
    setStartingServer(true)
    fetch(`${BACKEND_URL}/start-match-server`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobbyId }),
    })
      .then(r => r.json())
      .then(data => { if (data.port) setGamePort(data.port) })
      .catch(e => console.error('start-match-server error:', e))
      .finally(() => setStartingServer(false))
  }, [lobby?.started, lobbyId, gamePort, startingServer])

  useEffect(() => { loadLobby(false) }, [loadLobby])

  const loadLobbyRef = useRef(loadLobby)
  useEffect(() => { loadLobbyRef.current = loadLobby }, [loadLobby])

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null
    let timer: ReturnType<typeof setTimeout>
    subscribeToContract(CONTRACT_ADDRESS, () => {
      clearTimeout(timer)
      timer = setTimeout(() => loadLobbyRef.current(true), REACTIVITY_DELAY)
    }).then(s => { sub = s })
    return () => { sub?.unsubscribe(); clearTimeout(timer) }
  }, [])

  const isCreator = lobby?.creator.toLowerCase() === currentAddress.toLowerCase()
  const myPlayer = lobby?.players.find(p => p.address.toLowerCase() === currentAddress.toLowerCase())
  const amReady = myPlayer?.ready ?? false

  const handleDisband = async () => {
   if (!walletClient || !currentAddress) return
   if (!confirm('Disband lobby? All operators will be refunded.')) return
    setActionLoading(true)
   try {
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'disbandLobby', args: [BigInt(lobbyId)],
        chain: somniaTestnet, account: currentAddress as `0x${string}`,
     })
     await publicClient.waitForTransactionReceipt({ hash })
     showToast('Lobby disbanded. All operators refunded.')
     onLeft()
   } catch (e: unknown) {
     showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
   }
    setActionLoading(false)
  }

  const handleToggleReady = async () => {
    if (!walletClient || !currentAddress) return
    setActionLoading(true)
    try {
      const fn = amReady ? 'setUnready' : 'setReady'
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: fn, args: [BigInt(lobbyId)],
        chain: somniaTestnet, account: currentAddress as `0x${string}`,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await loadLobby(true)
      showToast(amReady ? 'Status: NOT READY' : 'Status: READY')
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setActionLoading(false)
  }

  const handleKick = async (player: LobbyPlayer) => {
    if (!walletClient || !currentAddress) return
    setActionLoading(true)
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'kickPlayer',
        args: [BigInt(lobbyId), player.address as `0x${string}`],
        chain: somniaTestnet, account: currentAddress as `0x${string}`,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await loadLobby(true)
      showToast(`${player.nickname} kicked`)
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setActionLoading(false)
  }

  const handleLeave = async () => {
    if (!walletClient || !currentAddress) return
    setActionLoading(true)
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'leaveLobby', args: [BigInt(lobbyId)],
        chain: somniaTestnet, account: currentAddress as `0x${string}`,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showToast('Left the session')
      onLeft()
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setActionLoading(false)
  }

  if (loading) return <div className="empty-state">LOADING SESSION...</div>
  if (!lobby) return <div className="empty-state">Session not found</div>

  const team1 = lobby.players.filter(p => p.team === 1)
  const team2 = lobby.players.filter(p => p.team === 2)
  const allReady = lobby.players.length >= 2 && lobby.players.every(p => p.ready)

  return (
    <div className="current-session">
      <div className="session-header">
        <div>
          <h2>SESSION #{lobby.lobbyId}</h2>
          <span className="session-meta">
            {parseFloat(formatEther(lobby.costPerLife)).toFixed(4)} STT/life
            &nbsp;·&nbsp;
            {lobby.players.length}/{lobby.maxPlayers} operators
          </span>
        </div>
        <div className="session-actions">
          {!lobby.started && myPlayer && (
            <button
              className={amReady ? 'btn-ready btn-ready-active' : 'btn-ready'}
              onClick={handleToggleReady}
              disabled={actionLoading}
            >
              {amReady ? '✓ READY' : '— NOT READY'}
            </button>
          )}
          {!lobby.started && !isCreator && (
            <button className="btn-secondary btn-danger" onClick={handleLeave} disabled={actionLoading}>
              LEAVE
            </button>
          )}
          {isCreator && !lobby.started && (
              <button
                className="btn-secondary btn-danger"
               onClick={handleDisband}
               disabled={actionLoading}
              >
                ✕ DISBAND
              </button>
          )}
        </div>
      </div>

      {lobby.started && (
        <div className="session-started-banner">
          {isCreator ? (
            <a href={`shinia://wallet=${currentAddress}&lobbyId=${lobbyId}&port=listen`} className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              ▶ LAUNCH GAME (HOST)
            </a>
          ) : (
            <a href={`shinia://wallet=${currentAddress}&lobbyId=${lobbyId}&port=127.0.0.1:7777`} className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              ▶ LAUNCH GAME (JOIN)
            </a>
          )}
        </div>
      )}

      {allReady && !lobby.started && (
        <div className="session-all-ready">
          ✓ ALL OPERATORS READY — Match starting...
        </div>
      )}

      <div className="session-teams">
        {/* Team A */}
        <div className="team-column">
          <div className="team-label team-a">TEAM ALPHA</div>
          {team1.map(p => (
            <div key={p.address} className={`player-row ${p.address.toLowerCase() === currentAddress.toLowerCase() ? 'player-row-me' : ''}`}>
              <div className="player-info">
                {p.address.toLowerCase() === lobby.creator.toLowerCase() && (
                  <span className="crown-badge" title="Commander">👑</span>
                )}
                <span className="player-nick">{p.nickname}</span>
                <span className="player-addr">{`${p.address.slice(0, 4)}...${p.address.slice(-3)}`}</span>
              </div>
              <div className="player-status">
                <span className={p.ready ? 'status-ready' : 'status-notready'}>
                  {p.ready ? '✓ READY' : '— WAIT'}
                </span>
                {isCreator && p.address.toLowerCase() !== currentAddress.toLowerCase() && !lobby.started && (
                  <button className="btn-kick" onClick={() => handleKick(p)} disabled={actionLoading} title="Kick operator">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {team1.length === 0 && <div className="empty-team">No operators</div>}
        </div>

        {/* Team B */}
        <div className="team-column">
          <div className="team-label team-b">TEAM BRAVO</div>
          {team2.map(p => (
            <div key={p.address} className={`player-row ${p.address.toLowerCase() === currentAddress.toLowerCase() ? 'player-row-me' : ''}`}>
              <div className="player-info">
                {p.address.toLowerCase() === lobby.creator.toLowerCase() && (
                  <span className="crown-badge" title="Commander">👑</span>
                )}
                <span className="player-nick">{p.nickname}</span>
                <span className="player-addr">{`${p.address.slice(0, 4)}...${p.address.slice(-3)}`}</span>
              </div>
              <div className="player-status">
                <span className={p.ready ? 'status-ready' : 'status-notready'}>
                  {p.ready ? '✓ READY' : '— WAIT'}
                </span>
                {isCreator && p.address.toLowerCase() !== currentAddress.toLowerCase() && !lobby.started && (
                  <button className="btn-kick" onClick={() => handleKick(p)} disabled={actionLoading} title="Kick operator">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {team2.length === 0 && <div className="empty-team">No operators</div>}
        </div>
      </div>
    </div>
  )
}

// ─── Admin Panel ─────────────────────────────────────────────────────────────

function AdminPanel({ showToast }: { showToast: (msg: string, ok?: boolean) => void }) {
  const { data: walletClient } = useWalletClient()
  const { address } = useAccount()
  const [loading, setLoading] = useState(false)
  const [lobbyIdInput, setLobbyIdInput] = useState('')

  const handleDisbandAll = async () => {
    if (!confirm('Disband ALL active lobbies?')) return
    setLoading(true)
    try {
      const count = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'lobbyCount',
      }) as bigint
      for (let i = 0; i < Number(count); i++) {
        const [, , , , active, started] = await publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
          functionName: 'getLobbyInfo', args: [BigInt(i)],
        }) as [string, bigint, number, bigint, boolean, boolean]
        if (active && !started && walletClient) {
          try {
            const hash = await walletClient.writeContract({
              address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
              functionName: 'disbandLobby', args: [BigInt(i)],
              chain: somniaTestnet, account: address as `0x${string}`,
            })
            await publicClient.waitForTransactionReceipt({ hash })
          } catch { /* skip */ }
        }
      }
      showToast('All lobbies disbanded!')
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setLoading(false)
  }

  const handleEndMatch = async () => {
    const id = Number(lobbyIdInput)
    if (isNaN(id)) { showToast('Invalid lobby ID', false); return }
    setLoading(true)
    try {
      await fetch(`${BACKEND_URL}/end-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobbyId: id, winningTeam: 1 }),
      })
      showToast(`Match #${id} ended!`)
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginRight: 8 }}>
      <span style={{ color: 'var(--accent)', fontSize: 11, opacity: 0.7 }}>ADMIN</span>
      <button className="btn-secondary btn-danger" onClick={handleDisbandAll} disabled={loading} style={{ fontSize: 11, padding: '4px 8px' }}>
        Disband All
      </button>
      <input
        type="number" placeholder="Lobby ID"
        value={lobbyIdInput} onChange={e => setLobbyIdInput(e.target.value)}
        style={{ width: 70, fontSize: 11, padding: '4px 6px', background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4 }}
      />
      <button className="btn-secondary btn-danger" onClick={handleEndMatch} disabled={loading} style={{ fontSize: 11, padding: '4px 8px' }}>
        End Match
      </button>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const { setOpenConnectModal } = useOpenConnectModal()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { data: walletClient } = useWalletClient()

  const [activeTab, setActiveTab] = useState<'lobbies' | 'create' | 'session' | 'leaderboard'>('lobbies')
  const [nickname, setNickname] = useState('')
  const [nicknameSet, setNicknameSet] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')
  const [isChangingNick, setIsChangingNick] = useState(false)
  const [balance, setBalance] = useState('...')
  const [loading, setLoading] = useState(false)
  const [checkingNick, setCheckingNick] = useState(true)
  const [showQR, setShowQR] = useState(false)
  const [copied, setCopied] = useState(false)
  const [withdrawTo, setWithdrawTo] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [currentLobbyId, setCurrentLobbyId] = useState<number | null>(null)

  const subRef = useRef<{ unsubscribe: () => void } | null>(null)
  const initializedRef = useRef(false)

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const fetchBalance = useCallback(async (addr: `0x${string}`) => {
    try {
      const result = await publicClient.getBalance({ address: addr })
      setBalance(parseFloat(formatEther(result)).toFixed(4))
    } catch { /* ignore */ }
  }, [])

  const fetchNickname = useCallback(async (addr: `0x${string}`) => {
    try {
      const nick = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'playerNicknames', args: [addr],
      })
      if (typeof nick === 'string' && nick.length > 0) {
        setNickname(nick); setNicknameSet(true); return true
      }
      setNicknameSet(false); return false
    } catch { setNicknameSet(false); return false }
  }, [])

  const checkCurrentLobby = useCallback(async (addr: `0x${string}`) => {
    try {
      const lobbyIdx = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'playerCurrentLobby', args: [addr],
      }) as bigint
      if (lobbyIdx >= 0n) {
        setCurrentLobbyId(Number(lobbyIdx))
        setActiveTab('session')
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!isConnected || !address) { initializedRef.current = false; return }
    if (initializedRef.current) return
    initializedRef.current = true

    Promise.all([fetchBalance(address), fetchNickname(address), checkCurrentLobby(address)])
      .finally(() => setCheckingNick(false))

    subscribeToContract(CONTRACT_ADDRESS, () => {
      fetchBalance(address)
      fetchNickname(address)
    }).then(sub => { if (sub) subRef.current = sub })

    return () => {
      subRef.current?.unsubscribe()
      subRef.current = null
    }
  }, [isConnected, address, fetchBalance, fetchNickname, checkCurrentLobby])

  useEffect(() => {
    if (!isConnected || !address) return
    const id = setInterval(() => fetchBalance(address), 3000)
    return () => clearInterval(id)
  }, [isConnected, address, fetchBalance])

  const handleConfirmNick = async () => {
    const valid = /^[A-Z0-9-_]{3,15}$/.test(nicknameInput)
    if (!valid) { showToast('Callsign: 3-15 chars, A-Z 0-9 - _', false); return }
    if (!address || !walletClient) { showToast('No wallet found', false); return }
    setLoading(true)
    try {
      const owner = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'nicknameOwner', args: [nicknameInput],
      }) as string
      if (owner !== '0x0000000000000000000000000000000000000000' &&
        owner.toLowerCase() !== address.toLowerCase()) {
        showToast('Callsign already taken!', false); setLoading(false); return
      }
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
        functionName: 'setNickname', args: [nicknameInput],
        chain: somniaTestnet, account: address,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await fetchNickname(address)
      setIsChangingNick(false)
      showToast('Callsign saved!')
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setLoading(false)
  }

  const handleWithdraw = async () => {
    if (!withdrawTo.match(/^0x[0-9a-fA-F]{40}$/)) { showToast('Invalid address', false); return }
    if (!walletClient || !address) return
    setWithdrawing(true)
    try {
      const bal = await publicClient.getBalance({ address })
      if (bal === 0n) { showToast('Zero balance', false); setWithdrawing(false); return }
      const gasEstimate = 21000n * 2000000000n
      const sendAmount = bal - gasEstimate
      if (sendAmount <= 0n) { showToast('Insufficient balance for gas', false); setWithdrawing(false); return }
      const hash = await walletClient.sendTransaction({
        to: withdrawTo as `0x${string}`, value: sendAmount,
        account: address, chain: somniaTestnet,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await fetchBalance(address)
      showToast('Withdrawn successfully!')
      setWithdrawTo('')
      setShowQR(false)
    } catch (e: unknown) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`, false)
    }
    setWithdrawing(false)
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    showToast('Address copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLobbyEntered = (lobbyId: number) => {
    setCurrentLobbyId(lobbyId)
    setActiveTab('session')
  }

  const handleLobbyLeft = () => {
    setCurrentLobbyId(null)
    setActiveTab('lobbies')
  }

  if (!isConnected) {
    return (
      <div className="auth-screen">
        <div className="auth-bg" />
        <div className="auth-container">
          <h1 className="game-title">SHINIA</h1>
          <p className="game-subtitle">Multiplayer FPS &nbsp;·&nbsp; Somnia Blockchain</p>
          <button className="btn-primary" onClick={() => setOpenConnectModal(true)}>
            Connect &nbsp;//&nbsp; Login
          </button>
        </div>
      </div>
    )
  }

  if (checkingNick) return <div className="loading">CHECKING IDENTITY...</div>

  if (!nicknameSet && !isChangingNick) {
    return (
      <div className="auth-screen">
        <div className="auth-bg" />
        <div className="auth-container">
          <h1 className="game-title" style={{ fontSize: '48px' }}>CALLSIGN</h1>
          <p className="game-subtitle">Choose your operator callsign</p>
          <p className="wallet-hint">{shortAddress}</p>
          <div className="nickname-form">
            <input className="nickname-input" type="text" placeholder={shortAddress}
              value={nicknameInput}
              onChange={e => setNicknameInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-_]/g, ''))}
              maxLength={15} />
            <button className="btn-primary" onClick={handleConfirmNick} disabled={loading}>
              {loading ? 'SAVING...' : 'Confirm Callsign'}
            </button>
          </div>
        </div>
        <Toast toast={toast} />
      </div>
    )
  }

  const nickModal = isChangingNick && (
    <div className="modal-overlay" onClick={() => setIsChangingNick(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>CHANGE CALLSIGN</span>
          <button onClick={() => setIsChangingNick(false)}>✕</button>
        </div>
        <p className="modal-sub">Current: <span style={{ color: 'var(--accent)' }}>{nickname}</span></p>
        <div className="nickname-form" style={{ marginTop: 16 }}>
          <input className="nickname-input" type="text" placeholder="NEW CALLSIGN"
            value={nicknameInput}
            onChange={e => setNicknameInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-_]/g, ''))}
            maxLength={15} />
          <button className="btn-primary" onClick={handleConfirmNick} disabled={loading}>
            {loading ? 'SAVING...' : 'Confirm'}
          </button>
          <button className="btn-secondary" onClick={() => setIsChangingNick(false)}>Cancel</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">SHINIA</div>
          <div className="status-pill">
            <div className="status-dot" />
            <span>SOMNIA TESTNET</span>
          </div>
        </div>
        <div className="header-right">
          <button className="operator-block operator-clickable"
            onClick={() => { setIsChangingNick(true); setNicknameInput(nickname) }}
            title="Click to change callsign">
            <span className="operator-label">OPERATOR ✎</span>
            <span className="operator-name">{nickname}</span>
          </button>
          <div className="balance-block">
            <span className="balance-val">{balance} STT</span>
            <button className="btn-topup" onClick={() => setShowQR(true)}>↑</button>
          </div>
          <button className="btn-secondary btn-danger" onClick={() => disconnect()}>✕ Exit</button>
        </div>
      </header>

      {showQR && (
        <div className="modal-overlay" onClick={() => setShowQR(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>WALLET</span>
              <button onClick={() => setShowQR(false)}>✕</button>
            </div>
            <p className="modal-sub">Send STT to your wallet:</p>
            <img src={QR_API(address!)} alt="QR" className="qr-img" />
            <div className="modal-addr-row">
              <span className="modal-addr-text">{address}</span>
              <button className="btn-copy" onClick={() => handleCopy(address!)}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="withdraw-section">
              <div className="modal-header" style={{ marginTop: 20, marginBottom: 12 }}>
                <span>WITHDRAW STT</span>
              </div>
              <p className="modal-sub">Only outside of match</p>
              <input className="withdraw-input" type="text" placeholder="0x... destination address"
                value={withdrawTo} onChange={e => setWithdrawTo(e.target.value)} />
              <button className="btn-primary" style={{ width: '100%', marginTop: 10 }}
                onClick={handleWithdraw} disabled={withdrawing}>
                {withdrawing ? 'WITHDRAWING...' : `WITHDRAW ${balance} STT`}
              </button>
            </div>
          </div>
        </div>
      )}

      {nickModal}

      <main className="main">
        <div className="tabs">
          <button className={activeTab === 'lobbies' ? 'tab active' : 'tab'} onClick={() => setActiveTab('lobbies')}>
            Active Sessions
          </button>
          <button className={activeTab === 'create' ? 'tab active' : 'tab'} onClick={() => setActiveTab('create')}>
            Deploy Session
          </button>
          {currentLobbyId !== null && (
            <button className={activeTab === 'session' ? 'tab active tab-session' : 'tab tab-session'} onClick={() => setActiveTab('session')}>
              ⬡ Staging #{currentLobbyId}
            </button>
          )}
          <button className={activeTab === 'leaderboard' ? 'tab active' : 'tab'} onClick={() => setActiveTab('leaderboard')}>
            Leaderboard
          </button>
        </div>

        {activeTab === 'lobbies' && (
          <LobbyList
            onJoin={handleLobbyEntered}
            showToast={showToast}
            currentAddress={address ?? ''}
          />
        )}
        {activeTab === 'create' && (
          <CreateLobby showToast={showToast} onCreated={handleLobbyEntered} />
        )}
        {activeTab === 'session' && currentLobbyId !== null && (
          <CurrentSession
            lobbyId={currentLobbyId}
            currentAddress={address ?? ''}
            showToast={showToast}
            onLeft={handleLobbyLeft}
          />
        )}
        {activeTab === 'leaderboard' && <Leaderboard />}
      </main>

      <footer className="status-bar">
        <span>CONTRACT: 0xbd6e...7c</span>
        <span>·</span><span>CHAIN ID: 50312</span>
        <span>·</span><span>WALLET: {shortAddress}</span>
        <div className="status-bar-right">
          {address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase() && (
            <AdminPanel showToast={showToast} />
          )}
          <a className="btn-download" href="https://shinia.mom/download/ShiniaClient.zip">
            ↓ Download Client
          </a>
        </div>
      </footer>

      <Toast toast={toast} />
    </div>
  )
}

export default App
