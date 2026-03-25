#include "ShiniaReactivity.h"
#include "WebSocketsModule.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

AShiniaReactivity::AShiniaReactivity()
{
    PrimaryActorTick.bCanEverTick = false;
}

void AShiniaReactivity::BeginPlay()
{
    Super::BeginPlay();
}

void AShiniaReactivity::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    Disconnect();
    Super::EndPlay(EndPlayReason);
}

void AShiniaReactivity::Connect(const FString &WsUrl, const FString &ContractAddress)
{
    Contract = ContractAddress.ToLower();

    if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
    {
        FModuleManager::Get().LoadModule("WebSockets");
    }

    WebSocket = FWebSocketsModule::Get().CreateWebSocket(WsUrl, TEXT("ws"));

    WebSocket->OnMessage().AddUObject(this, &AShiniaReactivity::OnMessage);

    WebSocket->OnConnected().AddLambda([this]()
                                       {
        UE_LOG(LogTemp, Log, TEXT("[Reactivity] Connected to Somnia WebSocket"));

        FString SubMsg = FString::Printf(
            TEXT("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_subscribe\",\"params\":[\"logs\",{\"address\":\"%s\"}]}"),
            *Contract
        );
        WebSocket->Send(SubMsg); });

    WebSocket->OnConnectionError().AddLambda([](const FString &Error)
                                             { UE_LOG(LogTemp, Error, TEXT("[Reactivity] Connection error: %s"), *Error); });

    WebSocket->OnClosed().AddLambda([](int32 Code, const FString &Reason, bool bWasClean)
                                    { UE_LOG(LogTemp, Log, TEXT("[Reactivity] Disconnected: %s"), *Reason); });

    WebSocket->Connect();
    UE_LOG(LogTemp, Log, TEXT("[Reactivity] Connecting to %s"), *WsUrl);
}

void AShiniaReactivity::Disconnect()
{
    if (WebSocket.IsValid() && WebSocket->IsConnected())
    {
        WebSocket->Close();
    }
}

void AShiniaReactivity::OnMessage(const FString &Message)
{
    UE_LOG(LogTemp, Log, TEXT("[Reactivity] Message: %s"), *Message);
    ParseEvent(Message);
}

void AShiniaReactivity::ParseEvent(const FString &Message)
{
    TSharedPtr<FJsonObject> Root;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);
    if (!FJsonSerializer::Deserialize(Reader, Root))
        return;

    const TSharedPtr<FJsonObject> *ParamsObj;
    if (!Root->TryGetObjectField(TEXT("params"), ParamsObj))
        return;

    const TSharedPtr<FJsonObject> *ResultObj;
    if (!(*ParamsObj)->TryGetObjectField(TEXT("result"), ResultObj))
        return;

    const TArray<TSharedPtr<FJsonValue>> *Topics;
    if (!(*ResultObj)->TryGetArrayField(TEXT("topics"), Topics))
        return;
    if (Topics->Num() == 0)
        return;

    FString Topic0 = (*Topics)[0]->AsString().ToLower();

    FString PlayerKilledTopic = TEXT("0x49625ad14f69713e23e059829df58b2548216e1248e9ae1ed05b10520aac301a");

    FString MatchEndedTopic = TEXT("0x8361531be64e30fb78f900bccc3142c67140c36c0b193dad1928abe0feef084a");

    if (Topic0 == PlayerKilledTopic)
    {
        FString Victim = Topics->Num() > 2 ? (*Topics)[2]->AsString() : TEXT("");
        FString Killer = Topics->Num() > 3 ? (*Topics)[3]->AsString() : TEXT("");

        UE_LOG(LogTemp, Log, TEXT("[Reactivity] PlayerKilled: victim=%s killer=%s"), *Victim, *Killer);
        OnPlayerKilled.Broadcast(Victim, Killer, 0);
    }
    else if (Topic0 == MatchEndedTopic)
    {
        UE_LOG(LogTemp, Log, TEXT("[Reactivity] MatchEnded!"));
        OnMatchEnded.Broadcast(1);
    }
}