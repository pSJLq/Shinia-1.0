#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "IWebSocket.h"
#include "ShiniaReactivity.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FOnPlayerKilled,
                                               const FString &, Victim,
                                               const FString &, Killer,
                                               int32, Amount);

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMatchEnded,
                                            int32, WinningTeam);

UCLASS(Blueprintable)
class SHINIA_API AShiniaReactivity : public AActor
{
    GENERATED_BODY()

public:
    AShiniaReactivity();

    UPROPERTY(BlueprintAssignable, Category = "Shinia|Reactivity")
    FOnPlayerKilled OnPlayerKilled;

    UPROPERTY(BlueprintAssignable, Category = "Shinia|Reactivity")
    FOnMatchEnded OnMatchEnded;

    UFUNCTION(BlueprintCallable, Category = "Shinia|Reactivity")
    void Connect(const FString &WsUrl, const FString &ContractAddress);

    UFUNCTION(BlueprintCallable, Category = "Shinia|Reactivity")
    void Disconnect();

protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
    TSharedPtr<IWebSocket> WebSocket;
    FString Contract;

    void OnMessage(const FString &Message);
    void ParseEvent(const FString &Message);
};