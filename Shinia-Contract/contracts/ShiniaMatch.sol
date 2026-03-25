// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ShiniaMatch {
    address public owner;
    address public devWallet;

    struct Lobby {
        address creator;
        uint256 costPerLife;
        uint8 maxPlayers;
        address[] players;
        uint8[] teams;
        uint256 rewardPool;
        bool active;
        bool started;
    }

    mapping(uint256 => Lobby) public lobbies;
    mapping(uint256 => mapping(address => bool)) public isReady;
    mapping(uint256 => mapping(address => bool)) public isSpectator;
    mapping(uint256 => mapping(address => uint256)) public playerKills;
    mapping(uint256 => mapping(address => uint256)) public playerDeaths;
    mapping(uint256 => mapping(address => bool)) public isKicked;
    mapping(uint256 => mapping(address => address)) public lastKilledBy;

    mapping(address => int256) public playerCurrentLobby;

    uint256 public lobbyCount;

    mapping(address => string) public playerNicknames;
    mapping(string => address) public nicknameOwner;

    mapping(address => uint256) public totalKills;
    mapping(address => uint256) public totalDeaths;
    mapping(address => uint256) public totalWins;
    mapping(address => uint256) public totalLosses;
    mapping(address => uint256) public totalEarned;

    mapping(address => bool) public inMatch;

    address[] public allPlayers;
    mapping(address => bool) public isRegistered;

    event NicknameSet(address indexed player, string nickname);
    event LobbyCreated(
        uint256 indexed lobbyId,
        address indexed creator,
        uint256 costPerLife,
        uint8 maxPlayers
    );
    event PlayerJoined(
        uint256 indexed lobbyId,
        address indexed player,
        uint8 team
    );
    event PlayerReady(uint256 indexed lobbyId, address indexed player);
    event PlayerUnready(uint256 indexed lobbyId, address indexed player);
    event PlayerKicked(
        uint256 indexed lobbyId,
        address indexed player,
        address indexed kickedBy
    );
    event LobbyStarted(uint256 indexed lobbyId);
    event LobbyDisbanded(uint256 indexed lobbyId, address indexed creator);
    event PlayerRespawned(uint256 indexed lobbyId, address indexed player);
    event PlayerKilled(
        uint256 indexed lobbyId,
        address indexed victim,
        address indexed killer,
        uint256 amount
    );
    event PlayerBecameSpectator(
        uint256 indexed lobbyId,
        address indexed player
    );
    event MatchEnded(uint256 indexed lobbyId, uint8 winningTeam);
    event RewardsDistributed(uint256 indexed lobbyId, uint8 winningTeam);
    event StatsUpdated(
        uint256 indexed lobbyId,
        address indexed player,
        uint256 kills,
        uint256 deaths
    );
    event GlobalStatsUpdated(
        address indexed player,
        uint256 killsDelta,
        uint256 deathsDelta,
        uint256 winDelta,
        uint256 lossDelta,
        uint256 earnedDelta,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _devWallet) {
        owner = msg.sender;
        devWallet = _devWallet;
    }

    function _registerPlayer(address player) internal {
        if (!isRegistered[player]) {
            isRegistered[player] = true;
            allPlayers.push(player);
            playerCurrentLobby[player] = -1;
        }
    }

    function setNickname(string calldata nickname) external {
        require(bytes(nickname).length >= 3, "Too short");
        require(bytes(nickname).length <= 15, "Too long");
        require(
            nicknameOwner[nickname] == address(0) ||
                nicknameOwner[nickname] == msg.sender,
            "Nickname taken"
        );
        string memory oldNick = playerNicknames[msg.sender];
        if (bytes(oldNick).length > 0) delete nicknameOwner[oldNick];
        playerNicknames[msg.sender] = nickname;
        nicknameOwner[nickname] = msg.sender;
        _registerPlayer(msg.sender);
        emit NicknameSet(msg.sender, nickname);
    }

    function getNickname(address player) external view returns (string memory) {
        return playerNicknames[player];
    }

    function createLobby(
        uint256 costPerLife,
        uint8 maxPlayers
    ) external returns (uint256) {
        require(costPerLife > 0, "Cost must be > 0");
        require(maxPlayers >= 2, "Max >= 2");
        require(playerCurrentLobby[msg.sender] < 0, "Already in a lobby");

        uint256 lobbyId = lobbyCount++;
        Lobby storage lobby = lobbies[lobbyId];
        lobby.creator = msg.sender;
        lobby.costPerLife = costPerLife;
        lobby.maxPlayers = maxPlayers;
        lobby.active = true;
        lobby.started = false;

        _registerPlayer(msg.sender);
        emit LobbyCreated(lobbyId, msg.sender, costPerLife, maxPlayers);
        return lobbyId;
    }

    function joinLobby(uint256 lobbyId, uint8 team) external payable {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.active && !lobby.started, "Lobby not available");
        require(lobby.players.length < lobby.maxPlayers, "Lobby full");
        require(team == 1 || team == 2, "Invalid team");
        require(msg.value == lobby.costPerLife, "Must deposit 1x cost");
        require(!isKicked[lobbyId][msg.sender], "You have been kicked");
        require(playerCurrentLobby[msg.sender] < 0, "Already in a lobby");

        uint256 toPool = (msg.value * 95) / 100;
        uint256 toDev = msg.value - toPool;
        lobby.rewardPool += toPool;
        (bool sent, ) = devWallet.call{value: toDev}("");
        require(sent, "Dev transfer failed");

        lobby.players.push(msg.sender);
        lobby.teams.push(team);
        inMatch[msg.sender] = true;
        playerCurrentLobby[msg.sender] = int256(lobbyId);

        _registerPlayer(msg.sender);
        emit PlayerJoined(lobbyId, msg.sender, team);
    }

    function setReady(uint256 lobbyId) external {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.active && !lobby.started, "Lobby not available");
        require(
            playerCurrentLobby[msg.sender] == int256(lobbyId),
            "Not in lobby"
        );

        isReady[lobbyId][msg.sender] = true;
        emit PlayerReady(lobbyId, msg.sender);

        bool allReady = true;
        for (uint i = 0; i < lobby.players.length; i++) {
            if (!isReady[lobbyId][lobby.players[i]]) {
                allReady = false;
                break;
            }
        }
        if (allReady && lobby.players.length >= 2) {
            lobby.started = true;
            emit LobbyStarted(lobbyId);
        }
    }

    function setUnready(uint256 lobbyId) external {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.active && !lobby.started, "Lobby not available");
        require(
            playerCurrentLobby[msg.sender] == int256(lobbyId),
            "Not in lobby"
        );

        isReady[lobbyId][msg.sender] = false;
        emit PlayerUnready(lobbyId, msg.sender);
    }

    function kickPlayer(uint256 lobbyId, address player) external {
        Lobby storage lobby = lobbies[lobbyId];
        require(!lobby.started, "Match already started");
        require(lobby.active, "Lobby not active");
        require(msg.sender == lobby.creator, "Only creator can kick");
        require(player != msg.sender, "Cannot kick yourself");
        require(
            playerCurrentLobby[player] == int256(lobbyId),
            "Player not in lobby"
        );

        isKicked[lobbyId][player] = true;
        inMatch[player] = false;
        playerCurrentLobby[player] = -1;

        for (uint i = 0; i < lobby.players.length; i++) {
            if (lobby.players[i] == player) {
                lobby.players[i] = lobby.players[lobby.players.length - 1];
                lobby.teams[i] = lobby.teams[lobby.teams.length - 1];
                lobby.players.pop();
                lobby.teams.pop();
                break;
            }
        }

        emit PlayerKicked(lobbyId, player, msg.sender);
    }

    function leaveLobby(uint256 lobbyId) external {
        Lobby storage lobby = lobbies[lobbyId];
        require(!lobby.started, "Match already started");
        require(
            playerCurrentLobby[msg.sender] == int256(lobbyId),
            "Not in lobby"
        );

        inMatch[msg.sender] = false;
        playerCurrentLobby[msg.sender] = -1;

        for (uint i = 0; i < lobby.players.length; i++) {
            if (lobby.players[i] == msg.sender) {
                lobby.players[i] = lobby.players[lobby.players.length - 1];
                lobby.teams[i] = lobby.teams[lobby.teams.length - 1];
                lobby.players.pop();
                lobby.teams.pop();
                break;
            }
        }
    }

    function disbandLobby(uint256 lobbyId) external {
        Lobby storage lobby = lobbies[lobbyId];
        require(msg.sender == lobby.creator, "Only creator can disband");
        require(!lobby.started, "Match already started");
        require(lobby.active, "Lobby not active");

        lobby.active = false;

        for (uint i = 0; i < lobby.players.length; i++) {
            inMatch[lobby.players[i]] = false;
            playerCurrentLobby[lobby.players[i]] = -1;
        }

        emit LobbyDisbanded(lobbyId, msg.sender);
    }

    function payRespawn(uint256 lobbyId) external payable {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.started, "Match not started");
        require(lobby.active, "Match ended");
        require(
            playerCurrentLobby[msg.sender] == int256(lobbyId),
            "Not in this lobby"
        );
        require(msg.value == lobby.costPerLife, "Wrong amount");

        uint256 toPool = (msg.value * 60) / 100;
        uint256 toKiller = (msg.value * 35) / 100;
        uint256 toDev = msg.value - toPool - toKiller;

        lobby.rewardPool += toPool;

        address killer = lastKilledBy[lobbyId][msg.sender];
        if (killer != address(0) && !isSpectator[lobbyId][killer]) {
            (bool ks, ) = killer.call{value: toKiller}("");
            if (!ks) lobby.rewardPool += toKiller;
        } else {
            lobby.rewardPool += toKiller;
        }

        (bool ds, ) = devWallet.call{value: toDev}("");
        require(ds, "Dev failed");

        if (isSpectator[lobbyId][msg.sender]) {
            isSpectator[lobbyId][msg.sender] = false;
        }

        emit PlayerRespawned(lobbyId, msg.sender);
    }

    function onPlayerDeath(
        uint256 lobbyId,
        address victim,
        address killer
    ) external onlyOwner {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.started, "Match not started");
        require(!isSpectator[lobbyId][victim], "Already spectator");

        playerKills[lobbyId][killer]++;
        playerDeaths[lobbyId][victim]++;
        lastKilledBy[lobbyId][victim] = killer;

        isSpectator[lobbyId][victim] = true;
        emit PlayerBecameSpectator(lobbyId, victim);
        emit PlayerKilled(lobbyId, victim, killer, lobby.costPerLife);

        emit StatsUpdated(
            lobbyId,
            killer,
            playerKills[lobbyId][killer],
            playerDeaths[lobbyId][killer]
        );
        emit StatsUpdated(
            lobbyId,
            victim,
            playerKills[lobbyId][victim],
            playerDeaths[lobbyId][victim]
        );

        _checkTeamBalance(lobbyId);
    }

    function endMatch(uint256 lobbyId, uint8 winningTeam) external onlyOwner {
        _endMatch(lobbyId, winningTeam);
    }

    function _checkTeamBalance(uint256 lobbyId) internal {
        Lobby storage lobby = lobbies[lobbyId];
        bool team1Active = false;
        bool team2Active = false;

        for (uint i = 0; i < lobby.players.length; i++) {
            if (!isSpectator[lobbyId][lobby.players[i]]) {
                if (lobby.teams[i] == 1) team1Active = true;
                if (lobby.teams[i] == 2) team2Active = true;
            }
        }

        if (!team1Active && !team2Active) return;
        if (!team1Active) _endMatch(lobbyId, 2);
        else if (!team2Active) _endMatch(lobbyId, 1);
    }

    function _endMatch(uint256 lobbyId, uint8 winningTeam) internal {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.started, "Match not started");
        require(lobby.active, "Already ended");

        lobby.active = false;
        emit MatchEnded(lobbyId, winningTeam);
        _distributeRewards(lobbyId, winningTeam);
    }

    function _distributeRewards(uint256 lobbyId, uint8 winningTeam) internal {
        Lobby storage lobby = lobbies[lobbyId];

        uint256 winnerCount = 0;
        for (uint i = 0; i < lobby.players.length; i++) {
            if (lobby.teams[i] == winningTeam) winnerCount++;
        }

        uint256 perWinner = winnerCount > 0
            ? lobby.rewardPool / winnerCount
            : 0;

        for (uint i = 0; i < lobby.players.length; i++) {
            address player = lobby.players[i];
            bool won = lobby.teams[i] == winningTeam;
            uint256 earned = won && winnerCount > 0 ? perWinner : 0;

            if (won && earned > 0) {
                (bool sent, ) = player.call{value: earned}("");
                require(sent, "Reward failed");
            }

            uint256 kills = playerKills[lobbyId][player];
            uint256 deaths = playerDeaths[lobbyId][player];

            totalKills[player] += kills;
            totalDeaths[player] += deaths;
            if (won) totalWins[player]++;
            else totalLosses[player]++;
            totalEarned[player] += earned;

            inMatch[player] = false;
            playerCurrentLobby[player] = -1;

            emit GlobalStatsUpdated(
                player,
                kills,
                deaths,
                won ? 1 : 0,
                won ? 0 : 1,
                earned,
                block.timestamp
            );
        }

        lobby.rewardPool = 0;
        emit RewardsDistributed(lobbyId, winningTeam);
    }

    function getPlayersCount() external view returns (uint256) {
        return allPlayers.length;
    }

    function getPlayerStats(
        address player
    )
        external
        view
        returns (
            uint256 kills,
            uint256 deaths,
            uint256 wins,
            uint256 losses,
            uint256 earned,
            string memory nickname
        )
    {
        return (
            totalKills[player],
            totalDeaths[player],
            totalWins[player],
            totalLosses[player],
            totalEarned[player],
            playerNicknames[player]
        );
    }

    function getLeaderboard(
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (
            address[] memory players,
            uint256[] memory kills,
            uint256[] memory deaths,
            uint256[] memory wins,
            uint256[] memory losses,
            uint256[] memory earned
        )
    {
        uint256 total = allPlayers.length;
        if (offset >= total) {
            return (
                new address[](0),
                new uint256[](0),
                new uint256[](0),
                new uint256[](0),
                new uint256[](0),
                new uint256[](0)
            );
        }
        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;

        players = new address[](count);
        kills = new uint256[](count);
        deaths = new uint256[](count);
        wins = new uint256[](count);
        losses = new uint256[](count);
        earned = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            address p = allPlayers[offset + i];
            players[i] = p;
            kills[i] = totalKills[p];
            deaths[i] = totalDeaths[p];
            wins[i] = totalWins[p];
            losses[i] = totalLosses[p];
            earned[i] = totalEarned[p];
        }
    }

    function getLobbyPlayers(
        uint256 lobbyId
    ) external view returns (address[] memory, uint8[] memory) {
        return (lobbies[lobbyId].players, lobbies[lobbyId].teams);
    }

    function getLobbyInfo(
        uint256 lobbyId
    )
        external
        view
        returns (
            address creator,
            uint256 costPerLife,
            uint8 maxPlayers,
            uint256 playerCount,
            bool active,
            bool started
        )
    {
        Lobby storage lobby = lobbies[lobbyId];
        return (
            lobby.creator,
            lobby.costPerLife,
            lobby.maxPlayers,
            lobby.players.length,
            lobby.active,
            lobby.started
        );
    }

    function setDevWallet(address _devWallet) external onlyOwner {
        devWallet = _devWallet;
    }

    function canRespawn(
        uint256 lobbyId,
        address player
    ) external view returns (bool) {
        Lobby storage lobby = lobbies[lobbyId];
        return
            lobby.started &&
            lobby.active &&
            playerCurrentLobby[player] == int256(lobbyId) &&
            isSpectator[lobbyId][player];
    }
}
