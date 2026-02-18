import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient, isAppError } from "@brpc/core";
import { createQueryClient, useRpcUtils } from "@brpc/react";
import type { AppRouter } from "./server";

const baseUrl = "http://localhost:3000/api";
const headers = { Authorization: "Bearer demo-user" };

const safeClient = createClient<AppRouter>({ baseUrl, headers });
const rpc = createQueryClient<AppRouter>({ baseUrl, headers });
const queryClient = new QueryClient();

export function ExampleApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <h2>brpc example</h2>
      <ChatList />
      <CreateChat />
    </QueryClientProvider>
  );
}

function ChatList() {
  const query = rpc.chat.list.useQuery();

  if (query.isPending) {
    return <p>Loading chats...</p>;
  }

  if (query.isError) {
    const error = query.error.payload;

    if (error.source === "app") {
      if (error.code === "UNAUTHORIZED") {
        return <p>Please sign in first.</p>;
      }

      return null;
    }

    return <p>System error. Please try again later.</p>;
  }

  return (
    <ul>
      {query.data.map((chat) => (
        <li key={chat.id}>{chat.title}</li>
      ))}
    </ul>
  );
}

function CreateChat() {
  const [title, setTitle] = useState("");
  const [previewMessage, setPreviewMessage] = useState<string>("");
  const { invalidate } = useRpcUtils(rpc);

  const mutation = rpc.chat.create.useMutation({
    onSuccess: async () => {
      setTitle("");
      await invalidate(rpc.chat.list);
    },
  });

  async function previewSafeResult() {
    const result = await safeClient.chat.create({ title });

    if (result.ok) {
      setPreviewMessage(`Safe result success: ${result.data.id}`);
      return;
    }

    if (isAppError(result)) {
      if (result.error.code === "TITLE_TOO_LONG") {
        setPreviewMessage(`Safe result app error: ${result.error.message}`);
        return;
      }

      setPreviewMessage(`Safe result app error: ${result.error.code}`);
      return;
    }

    setPreviewMessage("Safe result system error");
  }

  function renderMutationError() {
    if (!mutation.error) {
      return null;
    }

    const error = mutation.error.payload;

    if (error.source === "app") {
      if (error.code === "TITLE_TOO_LONG") {
        return <p>Title is too long (max 40 chars).</p>;
      }

      if (error.code === "TITLE_FORBIDDEN") {
        return <p>That title is forbidden.</p>;
      }

      if (error.code === "UNAUTHORIZED") {
        return <p>You are not authorized.</p>;
      }

      return null;
    }

    return <p>System error. Please try again later.</p>;
  }

  return (
    <div>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Chat title"
      />
      <button onClick={() => mutation.mutate({ title })}>Create via mutation</button>
      <button onClick={previewSafeResult}>Preview safe result</button>

      {mutation.isPending && <p>Creating...</p>}
      {renderMutationError()}
      {previewMessage && <p>{previewMessage}</p>}
    </div>
  );
}

export default ExampleApp;
