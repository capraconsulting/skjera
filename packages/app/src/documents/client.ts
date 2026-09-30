import { DocumentsRpc } from "@skjera/documents/api";
import { Context, Layer, ManagedRuntime } from "effect";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

const rpcUrl = () => {
  const url = new URL("/rpc", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

/** The documents API over one shared WebSocket, reconnecting when it drops. */
export class DocumentsClient extends Context.Service<
  DocumentsClient,
  RpcClient.FromGroup<typeof DocumentsRpc, RpcClientError.RpcClientError>
>()("@skjera/app/DocumentsClient") {
  static readonly layer = Layer.effect(
    DocumentsClient,
    RpcClient.make(DocumentsRpc),
  ).pipe(
    Layer.provide(
      RpcClient.layerProtocolSocket({ retryTransientErrors: true }),
    ),
    Layer.provide(Socket.layerWebSocket(rpcUrl())),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );
}

export const runtime = ManagedRuntime.make(DocumentsClient.layer);
