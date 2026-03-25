#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "ShiniaHttpClient.generated.h"

DECLARE_DYNAMIC_DELEGATE_TwoParams(FOnRespawnCheckResult, bool, bCanRespawn, const FString&, CostPerLife);

UCLASS(Blueprintable)
class SHINIA_API UShiniaHttpClient : public UObject
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category = "Shinia|HTTP")
    static void PostPlayerDeath(
        const FString& BackendUrl,
        int32 LobbyId,
        const FString& VictimWallet,
        const FString& KillerWallet);

    UFUNCTION(BlueprintCallable, Category = "Shinia|HTTP")
    static void PostEndMatch(
        const FString& BackendUrl,
        int32 LobbyId,
        int32 WinningTeam);

    // POST /pay-respawn — возвращает canRespawn + costPerLife (wei строка)
    UFUNCTION(BlueprintCallable, Category = "Shinia|HTTP")
    static void GetRespawnCheck(
        const FString& BackendUrl,
        int32 LobbyId,
        const FString& PlayerWallet,
        const FOnRespawnCheckResult& OnResult);

    // Кодирует calldata для payRespawn(uint256 lobbyId)
    // Возвращает hex строку вида "0x<selector><padded_lobbyId>"
    // Используется в Blueprint для пина Contract Call Data ноды Call
    UFUNCTION(BlueprintPure, Category = "Shinia|HTTP")
    static FString EncodePayRespawnCalldata(int32 LobbyId);

    // Конвертирует строку wei в int64 для пина Contract Call Value ноды Call
    UFUNCTION(BlueprintPure, Category = "Shinia|HTTP")
    static int64 CostPerLifeToInt64(const FString& CostPerLifeStr);

    DECLARE_DYNAMIC_DELEGATE_OneParam(FOnNicknameResult, const FString&, Nickname);

    UFUNCTION(BlueprintCallable, Category = "Shinia|HTTP")
    static void GetNickname(
        const FString& BackendUrl,
        const FString& WalletAddress,
        const FOnNicknameResult& OnResult);

    DECLARE_DYNAMIC_DELEGATE_EightParams(FOnMatchResultsReceived,
        const TArray<FString>&, Nicknames,
        const TArray<int32>&,   Kills,
        const TArray<int32>&,   Deaths,
        const TArray<FString>&, Wallets,
        const TArray<int32>&,   Teams,
        const TArray<FString>&, Earned,
        int32,                  Score1,
        int32,                  Score2);

    UFUNCTION(BlueprintCallable, Category = "Shinia|HTTP")
    static void GetMatchResults(
        const FString& BackendUrl,
        int32 LobbyId,
        const FOnMatchResultsReceived& OnResult);

    DECLARE_DYNAMIC_DELEGATE_FiveParams(FOnHudStatsReceived,
        const TArray<FString>&, Wallets,
        const TArray<int32>&,   Kills,
        const TArray<int32>&,   Deaths,
        int32,                  Score1,
        int32,                  Score2);

    UFUNCTION(BlueprintCallable, Category = "Shinia|HTTP")
    static void GetHudStats(
        const FString& BackendUrl,
        int32 LobbyId,
        const FOnHudStatsReceived& OnResult);
};
