# Shinia
The best onchain game ಠ_ಠ

I'm one of the active members of the Somnia community — I regularly take part in events (DS — pshinyq) 
and also make posts about Somnia (https://x.com/ShinyViq).
I’ve been planning to make a game for a long time. The thing is, 
there are almost no competitive games on Somnia right now — off the top of my head I can only remember Maelstrom and Dark Table.
And those games barely release any updates, don’t do collaborations, or run any events at all.

So I decided to create something of my own that I’ll keep updating constantly, 
even though I don’t know any programming languages (just a tiny bit of SQL and C#).
The shooter I’ve almost finished is basically just an experiment. 
What I’d really love to make is something like an MMO RPG on Somnia — that’s my absolute favorite genre.
What I showed in the video isn’t the full on-chain part. 
Every kill is recorded on the blockchain, and thanks to reactivity it’s instantly displayed on the player’s screen 
(Killfeed, final leaderboard, K/D counter, and team scores).

Since my team consists of just one person (me), and given that I don’t know anything yet (I’m only learning), 
I didn’t quite manage to finish everything I had planned. Right now the game only works in single-player mode 
(I’m currently fixing VPS issues so players can connect to the server and play together).
At the very least, you can already check out the website — it’s fully working with Reactivity.
If anything can be improved or redone, I’d be super happy to hear your criticism.
My goal now is to create a high-quality game on Somnia, and winning this hackathon would motivate me a ton.

I asked AI to help me explain everything as clearly as possible — how and what is implemented in my game. You can also check it in the other files I’ll attach :)
If you’re too lazy to open my project in UE5 and hunt for where everything is, I’ve attached screenshots for your convenience.
Where the Reactivity part is implemented:
https://imgur.com/a/AEnWjpP
https://imgur.com/a/Xdg6Krw

# Somnia Reactivity in Shinia — Real-Time Blockchain Gaming

## English

### Overview

Shinia is a blockchain-integrated multiplayer FPS built on Unreal Engine 5, where every kill, death, and match outcome is recorded immutably on the Somnia blockchain. The game's economy is fully on-chain: players deposit STT tokens to enter a match, lose funds upon death, and the winning team splits the pool. The entire real-time communication layer between the blockchain and all connected game clients is powered by **Somnia Reactivity**.

### The Problem Reactivity Solves

In a conventional blockchain game, clients have no way to know when a smart contract state has changed without actively polling the chain. Polling introduces latency, wastes RPC bandwidth, and produces a choppy, inconsistent experience — particularly unacceptable in a fast-paced FPS where kill events, score updates, and match endings must propagate to all players within milliseconds.

Somnia Reactivity replaces polling entirely. It establishes a persistent WebSocket connection to the Somnia node and delivers contract events as push notifications the moment they are emitted on-chain. This makes the blockchain feel as responsive as a traditional game server.

### Architecture

```
UE5 Game Server
    │
    ├── Player kills → HTTP POST /player-death
    │                       │
    │               Node.js Backend
    │                       │
    │               onPlayerDeath() ──► ShiniaMatch.sol
    │                                       │
    │                               emit PlayerKilled(lobbyId, victim, killer, amount)
    │                               emit StatsUpdated(lobbyId, player, kills, deaths)
    │                               emit MatchEnded(lobbyId, winningTeam)
    │                                       │
    │                           Somnia Reactivity WebSocket
    │                                       │
    └──────── Push to ALL UE5 clients simultaneously
```

The backend node (`ShiniaReactivity.cpp`) runs on the dedicated game server and subscribes to contract logs via `eth_subscribe`. All connected clients receive the same events in real time, ensuring perfect synchronization across the match.

### Use Cases

#### 1. Real-Time Kill Feed
Every time a player is killed, the contract emits a `PlayerKilled` event. Reactivity delivers this event instantly to all clients. The UE5 backend resolves wallet addresses to player nicknames via a lightweight HTTP call and invokes `MulticastKillFeed` — a replicated RPC that displays the kill entry on every connected player's HUD simultaneously.

```
PlayerKilled event (on-chain)
    → Reactivity WebSocket push
    → ShiniaReactivity.cpp parses topics[1] (victim), topics[2] (killer)
    → GET /nickname?wallet=... (x2)
    → MulticastKillFeed(killerNick, victimNick) → shown on all clients
```

#### 2. Live HUD Score & K/D Update
After each kill, the `PlayerKilled` event also triggers a `GET /hud-stats` request. The backend reads `playerKills` and `playerDeaths` mappings directly from the contract (per-match, not global), computes team scores, and broadcasts them via `MulticastUpdateHUD`. Every player's HUD reflects the true on-chain state — not a local counter that could desync.

#### 3. Match End & Results Screen
When the match timer expires, the game server calls `POST /end-match`. The backend reads kill data from the blockchain, determines the winning team algorithmically, and calls `endMatch()` on the contract. The contract emits `MatchEnded`. Reactivity pushes this event to all clients, triggering `OnMatchEndedHandler`, which fetches full match results — kills, deaths, earnings per player — directly from the chain, and calls `MulticastShowEndScreen` with verified on-chain data.

#### 4. Lobby Browser
The launcher uses Reactivity to subscribe to `LobbyCreated` and `LobbyStarted` events on the contract. When any player deploys a new session, all connected launcher instances update their active session list in real time without polling. This makes the lobby browser feel like a live feed rather than a static list that requires manual refresh.

### Technical Implementation

Reactivity is initialized in `ShiniaReactivity.cpp`, a custom C++ Actor that runs on the dedicated server:

```cpp
WebSocket->OnConnected().AddLambda([this]() {
    FString SubMsg = FString::Printf(
        TEXT("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_subscribe\","
             "\"params\":[\"logs\",{\"address\":\"%s\"}]}"),
        *Contract
    );
    WebSocket->Send(SubMsg);
});
```

Incoming log messages are parsed by their `topics[0]` signature hash (keccak256 of the event signature), and the appropriate Blueprint delegate is fired, triggering the UE5 Multicast RPC chain.

On the frontend (React/Vite launcher), Reactivity is initialized via the `@somnia-chain/reactivity` SDK:

```ts
const sdk = new SDK({ public: publicClient });
sdk.subscribeToContract({
  contractAddress: CONTRACT_ADDRESS,
  eventContractSources: [{ abi: CONTRACT_ABI, address: CONTRACT_ADDRESS }],
  callback: (event) => { /* update UI */ }
});
```

### Why Reactivity is Central to Shinia

Without Reactivity, Shinia would require either:
- Constant polling (every 1-3 seconds), creating latency spikes and hammering the RPC endpoint
- A centralized relay server, defeating the purpose of a decentralized economy

Reactivity is what makes it possible to build a genuinely real-time multiplayer experience on a blockchain. It closes the gap between on-chain finality and in-game responsiveness, enabling Shinia to deliver an experience that feels no different from a traditional game server — while all economic state remains fully verifiable and immutable on Somnia.

---

## Русский

Я один из учасников сообщества somnia, постоянно принимаю участие в мероприятиях(ds - pshinyq), а также делаю посты о somnia(https://x.com/ShinyViq).
Игру планировал делать давно, просто на somnia очень мало соревновательных игр, щас вспомню только maelstrom/dark table,
При этом эти игры почти не выпускают новых обновлений, не делают колобораций, или каких-либо событий.

Я решил создать что-то своё, что буду постоянно обновлять, хотя я не знаю никакого языка программировния(чуть чуть sql и C#)
Шутер который я почти сделал это просто эксперимент, и я бы очень хотел сделать что-то вроде MMO RPG на Somnia, это мой любимы жанр игр.
То что я показал в видео - не вся часть onchain, каждое убийство записывается в блокчейне, и при помощи reactivity отображается на экране пользователя
(Killfeed, final leaderboard, k/d counter and teams score).

Поскольку моя команда состоит всего из одного человека(я), и учитывая что я ничего не знаю(только учусь), я немного не успел доделать до конца то,
Что было мною задумано, сейчас игра работает только в одиночном режиме(я сейчас решаю проблемы с VPS, чтобы игроки могли подключаться к серверу и играть),
Как минимум сейчас вы можете уже проверить сайт, он уже работает используя Reactivity, 
Если что-то можно исправить или переделать, то я буду очень рад вашей критике.
Теперь моя цель сделать качественную игру на somnia и я буду очень замотивирован победой в этом хакатоне.

Я попросил ИИ помочь мне объяснить всё максимально понятно как и что реализовано в моей игре, вы так же можете проверить это в других файлах которые я приложу :)
Если вам лень открывать мой проект в ue5 и искать как что и где, я приложу скриншоты для вашего удобства.

Где реализована Reactivity часть?
https://imgur.com/a/AEnWjpP
https://imgur.com/a/Xdg6Krw

### Обзор

Shinia — мультиплеерный шутер от первого лица, интегрированный с блокчейном Somnia и построенный на Unreal Engine 5. Каждое убийство, каждая смерть и итог матча записываются в смарт-контракт. Экономика игры полностью ончейн: игроки вносят депозит в STT-токенах перед матчем, теряют часть средств при гибели, а победившая команда делит общий пул наград. Весь слой real-time коммуникации между блокчейном и игровыми клиентами обеспечивается **Somnia Reactivity**.

### Проблема, которую решает Reactivity

В традиционной блокчейн-игре клиенты не имеют способа узнать об изменении состояния смарт-контракта без активного опроса сети (polling). Polling вносит задержки, перегружает RPC-эндпоинт и порождает несогласованный пользовательский опыт — что категорически неприемлемо в динамичном шутере, где события убийств, обновления счёта и завершение матча должны мгновенно достигать всех игроков.

Somnia Reactivity полностью устраняет необходимость в polling. Он устанавливает постоянное WebSocket-соединение с нодой Somnia и доставляет события контракта как push-уведомления в момент их эмиссии в чейне. Благодаря этому блокчейн ощущается столь же отзывчивым, как обычный игровой сервер.

### Архитектура

```
UE5 Game Server
    │
    ├── Убийство игрока → HTTP POST /player-death
    │                           │
    │                   Node.js Backend
    │                           │
    │                   onPlayerDeath() ──► ShiniaMatch.sol
    │                                           │
    │                                   emit PlayerKilled(lobbyId, victim, killer, amount)
    │                                   emit StatsUpdated(lobbyId, player, kills, deaths)
    │                                   emit MatchEnded(lobbyId, winningTeam)
    │                                           │
    │                               Somnia Reactivity WebSocket
    │                                           │
    └────────── Push ко ВСЕМ клиентам UE5 одновременно
```

Нода Reactivity (`ShiniaReactivity.cpp`) запускается на выделенном игровом сервере и подписывается на логи контракта через `eth_subscribe`. Все подключённые клиенты получают одни и те же события в реальном времени, обеспечивая идеальную синхронизацию.

### Сценарии использования

#### 1. Килфид в реальном времени
При каждом убийстве контракт эмитирует событие `PlayerKilled`. Reactivity мгновенно доставляет его всем клиентам. Серверная часть UE5 резолвит адреса кошельков в ники игроков через HTTP-запрос и вызывает `MulticastKillFeed` — реплицированный RPC, который отображает запись об убийстве на HUD каждого подключённого игрока одновременно.

```
Событие PlayerKilled (on-chain)
    → Push через Reactivity WebSocket
    → ShiniaReactivity.cpp парсит topics[1] (жертва), topics[2] (убийца)
    → GET /nickname?wallet=... (x2)
    → MulticastKillFeed(killerNick, victimNick) → отображается у всех клиентов
```

#### 2. Обновление счёта и K/D на HUD
После каждого убийства событие `PlayerKilled` также инициирует запрос `GET /hud-stats`. Бэкенд читает маппинги `playerKills` и `playerDeaths` напрямую из контракта (в рамках конкретного матча, а не глобальную статистику), вычисляет счёт команд и рассылает данные через `MulticastUpdateHUD`. HUD каждого игрока отражает реальное состояние чейна — не локальный счётчик, способный рассинхронизироваться.

#### 3. Завершение матча и экран результатов
По истечении таймера матча игровой сервер вызывает `POST /end-match`. Бэкенд читает данные об убийствах из блокчейна, алгоритмически определяет победившую команду и вызывает `endMatch()` в контракте. Контракт эмитирует `MatchEnded`. Reactivity пушит это событие всем клиентам, активируя `OnMatchEndedHandler`, который загружает полные итоги матча — убийства, смерти, заработок каждого игрока — непосредственно из чейна и вызывает `MulticastShowEndScreen` с верифицированными on-chain данными.

#### 4. Браузер лобби
Лаунчер использует Reactivity для подписки на события `LobbyCreated` и `LobbyStarted` смарт-контракта. Когда любой игрок создаёт новую сессию, все подключённые экземпляры лаунчера обновляют список активных сессий в реальном времени без каких-либо опросов. Браузер лобби ощущается как живая лента, а не статический список, требующий ручного обновления.

### Техническая реализация

Reactivity инициализируется в `ShiniaReactivity.cpp` — кастомном C++ Actor, работающем на выделенном сервере:

```cpp
WebSocket->OnConnected().AddLambda([this]() {
    FString SubMsg = FString::Printf(
        TEXT("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_subscribe\","
             "\"params\":[\"logs\",{\"address\":\"%s\"}]}"),
        *Contract
    );
    WebSocket->Send(SubMsg);
});
```

Входящие сообщения парсятся по хэшу сигнатуры события в `topics[0]` (keccak256 от строки сигнатуры), после чего вызывается соответствующий Blueprint-делегат, запускающий цепочку Multicast RPC в UE5.

На фронтенде (React/Vite лаунчер) Reactivity инициализируется через SDK `@somnia-chain/reactivity`:

```ts
const sdk = new SDK({ public: publicClient });
sdk.subscribeToContract({
  contractAddress: CONTRACT_ADDRESS,
  eventContractSources: [{ abi: CONTRACT_ABI, address: CONTRACT_ADDRESS }],
  callback: (event) => { /* обновление UI */ }
});
```

### Почему Reactivity является ключевым для Shinia

Без Reactivity в Shinia потребовалось бы либо:
- Постоянный polling (каждые 1-3 секунды), создающий пики задержек и перегружающий RPC-эндпоинт
- Централизованный relay-сервер, что противоречит самой идее децентрализованной экономики

Именно Reactivity делает возможным создание по-настоящему real-time мультиплеерного опыта на блокчейне. Он устраняет разрыв между финальностью on-chain транзакций и отзывчивостью внутри игры, позволяя Shinia предоставлять опыт, неотличимый от традиционного игрового сервера — при этом всё экономическое состояние остаётся полностью верифицируемым и неизменяемым в Somnia.
