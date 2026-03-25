#include "ShiniaHttpClient.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// ─── ABI HELPERS ─────────────────────────────────────────────────────────────

// Кодирует calldata для payRespawn(uint256 lobbyId)
// ABI encoding:
//   bytes4 selector = keccak256("payRespawn(uint256)")[0:4]
//   + uint256(lobbyId) padded to 32 bytes
// Selector keccak256("payRespawn(uint256)") = 0x4ef49874
FString UShiniaHttpClient::EncodePayRespawnCalldata(int32 LobbyId)
{
    // Function selector для payRespawn(uint256)
    // = первые 4 байта keccak256("payRespawn(uint256)")
    FString Selector = TEXT("4ef49874");

    // ABI-encode uint256 lobbyId: padding нулями слева до 32 байт (64 hex символа)
    FString LobbyHex = FString::Printf(TEXT("%064x"), (uint64)LobbyId);

    return TEXT("0x") + Selector + LobbyHex;
}

// Конвертирует строку wei в int64
int64 UShiniaHttpClient::CostPerLifeToInt64(const FString& CostPerLifeStr)
{
    // FCString::Atoi64 парсит строку как int64
    return FCString::Atoi64(*CostPerLifeStr);
}

// ─── HTTP FUNCTIONS ───────────────────────────────────────────────────────────

void UShiniaHttpClient::PostPlayerDeath(
    const FString& BackendUrl,
    int32 LobbyId,
    const FString& VictimWallet,
    const FString& KillerWallet)
{
    FString Url  = BackendUrl + TEXT("/player-death");
    FString Body = FString::Printf(
        TEXT("{\"lobbyId\":%d,\"victim\":\"%s\",\"killer\":\"%s\"}"),
        LobbyId, *VictimWallet, *KillerWallet);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
        FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetContentAsString(Body);
    Request->ProcessRequest();

    UE_LOG(LogTemp, Log, TEXT("[Shinia] PostPlayerDeath: %s"), *Body);
}

void UShiniaHttpClient::PostEndMatch(
    const FString& BackendUrl,
    int32 LobbyId,
    int32 WinningTeam)
{
    FString Url  = BackendUrl + TEXT("/end-match");
    FString Body = FString::Printf(
        TEXT("{\"lobbyId\":%d,\"winningTeam\":%d}"),
        LobbyId, WinningTeam);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
        FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetContentAsString(Body);
    Request->ProcessRequest();

    UE_LOG(LogTemp, Log, TEXT("[Shinia] PostEndMatch: %s"), *Body);
}

void UShiniaHttpClient::GetRespawnCheck(
    const FString& BackendUrl,
    int32 LobbyId,
    const FString& PlayerWallet,
    const FOnRespawnCheckResult& OnResult)
{
    FString Url  = BackendUrl + TEXT("/pay-respawn");
    FString Body = FString::Printf(
        TEXT("{\"lobbyId\":%d,\"wallet\":\"%s\"}"),
        LobbyId, *PlayerWallet);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
        FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetContentAsString(Body);

    Request->OnProcessRequestComplete().BindLambda(
        [OnResult](FHttpRequestPtr Req, FHttpResponsePtr Res, bool bSuccess)
        {
            bool    bCanRespawn = false;
            FString CostPerLife = TEXT("0");

            if (bSuccess && Res.IsValid())
            {
                TSharedPtr<FJsonObject> JsonObject;
                TSharedRef<TJsonReader<>> Reader =
                    TJsonReaderFactory<>::Create(Res->GetContentAsString());

                if (FJsonSerializer::Deserialize(Reader, JsonObject))
                {
                    if (JsonObject->HasField(TEXT("canRespawn")))
                        bCanRespawn = JsonObject->GetBoolField(TEXT("canRespawn"));

                    if (JsonObject->HasField(TEXT("costPerLife")))
                        CostPerLife = JsonObject->GetStringField(TEXT("costPerLife"));
                }
            }

            UE_LOG(LogTemp, Log,
                TEXT("[Shinia] RespawnCheck: canRespawn=%s costPerLife=%s"),
                bCanRespawn ? TEXT("true") : TEXT("false"), *CostPerLife);

            OnResult.ExecuteIfBound(bCanRespawn, CostPerLife);
        });

    Request->ProcessRequest();
    UE_LOG(LogTemp, Log, TEXT("[Shinia] GetRespawnCheck POST: %s"), *Body);
}

void UShiniaHttpClient::GetNickname(
    const FString& BackendUrl,
    const FString& WalletAddress,
    const FOnNicknameResult& OnResult)
{
    FString Url = FString::Printf(
        TEXT("%s/nickname?wallet=%s"),
        *BackendUrl, *WalletAddress);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
        FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("GET"));

    Request->OnProcessRequestComplete().BindLambda(
        [OnResult](FHttpRequestPtr Req, FHttpResponsePtr Res, bool bSuccess)
        {
            FString Nick = TEXT("UNKNOWN");
            if (bSuccess && Res.IsValid())
            {
                TSharedPtr<FJsonObject> JsonObject;
                TSharedRef<TJsonReader<>> Reader =
                    TJsonReaderFactory<>::Create(Res->GetContentAsString());
                if (FJsonSerializer::Deserialize(Reader, JsonObject))
                    Nick = JsonObject->GetStringField(TEXT("nickname"));
            }
            OnResult.ExecuteIfBound(Nick);
        });

    Request->ProcessRequest();
}

void UShiniaHttpClient::GetMatchResults(
    const FString& BackendUrl,
    int32 LobbyId,
    const FOnMatchResultsReceived& OnResult)
{
    FString Url = FString::Printf(TEXT("%s/match-results?lobbyId=%d"), *BackendUrl, LobbyId);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
        FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("GET"));

    Request->OnProcessRequestComplete().BindLambda(
        [OnResult](FHttpRequestPtr Req, FHttpResponsePtr Res, bool bSuccess)
        {
            TArray<FString> Nicknames, Wallets, Earned;
            TArray<int32>   Kills, Deaths, Teams;
            int32 Score1 = 0, Score2 = 0;

            if (bSuccess && Res.IsValid())
            {
                TSharedPtr<FJsonObject> Root;
                TSharedRef<TJsonReader<>> Reader =
                    TJsonReaderFactory<>::Create(Res->GetContentAsString());

                if (FJsonSerializer::Deserialize(Reader, Root))
                {
                    if (Root->HasField(TEXT("score1")))
                        Score1 = Root->GetIntegerField(TEXT("score1"));
                    if (Root->HasField(TEXT("score2")))
                        Score2 = Root->GetIntegerField(TEXT("score2"));

                    const TArray<TSharedPtr<FJsonValue>>* Results;
                    if (Root->TryGetArrayField(TEXT("results"), Results))
                    {
                        for (const auto& Item : *Results)
                        {
                            const TSharedPtr<FJsonObject>& Obj = Item->AsObject();
                            Nicknames.Add(Obj->GetStringField(TEXT("nickname")));
                            Kills.Add(Obj->GetIntegerField(TEXT("kills")));
                            Deaths.Add(Obj->GetIntegerField(TEXT("deaths")));
                            Wallets.Add(Obj->GetStringField(TEXT("wallet")));
                            Teams.Add(Obj->GetIntegerField(TEXT("team")));
                            Earned.Add(Obj->GetStringField(TEXT("earned")));
                        }
                    }
                }
            }

            OnResult.ExecuteIfBound(Nicknames, Kills, Deaths, Wallets, Teams, Earned, Score1, Score2);
        });

    Request->ProcessRequest();
    UE_LOG(LogTemp, Log, TEXT("[Shinia] GetMatchResults lobby=%d"), LobbyId);
}

void UShiniaHttpClient::GetHudStats(
    const FString& BackendUrl,
    int32 LobbyId,
    const FOnHudStatsReceived& OnResult)
{
    FString Url = FString::Printf(TEXT("%s/hud-stats?lobbyId=%d"), *BackendUrl, LobbyId);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
        FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("GET"));

    Request->OnProcessRequestComplete().BindLambda(
        [OnResult](FHttpRequestPtr Req, FHttpResponsePtr Res, bool bSuccess)
        {
            TArray<FString> Wallets;
            TArray<int32>   Kills, Deaths;
            int32 Score1 = 0, Score2 = 0;

            if (bSuccess && Res.IsValid())
            {
                TSharedPtr<FJsonObject> Root;
                TSharedRef<TJsonReader<>> Reader =
                    TJsonReaderFactory<>::Create(Res->GetContentAsString());

                if (FJsonSerializer::Deserialize(Reader, Root))
                {
                    if (Root->HasField(TEXT("score1")))
                        Score1 = Root->GetIntegerField(TEXT("score1"));
                    if (Root->HasField(TEXT("score2")))
                        Score2 = Root->GetIntegerField(TEXT("score2"));

                    const TArray<TSharedPtr<FJsonValue>>* Stats;
                    if (Root->TryGetArrayField(TEXT("stats"), Stats))
                    {
                        for (const auto& Item : *Stats)
                        {
                            const TSharedPtr<FJsonObject>& Obj = Item->AsObject();
                            Wallets.Add(Obj->GetStringField(TEXT("wallet")));
                            Kills.Add(Obj->GetIntegerField(TEXT("kills")));
                            Deaths.Add(Obj->GetIntegerField(TEXT("deaths")));
                        }
                    }
                }
            }

            OnResult.ExecuteIfBound(Wallets, Kills, Deaths, Score1, Score2);
        });

    Request->ProcessRequest();
}
