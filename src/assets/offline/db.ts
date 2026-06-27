import { openDB } from "idb";

let dbp: ReturnType<typeof openDB>;

export function db() {
  if (!dbp) {
    dbp = openDB("todo-pwa", 1, {
      upgrade(d) {
        d.createObjectStore("tasks", { keyPath: "_id" });
        d.createObjectStore("outbox", { keyPath: "id" });
        d.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }

  return dbp;
}

export async function cacheTasks(list: any[]) {
  const tx = (await db()).transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");

  await store.clear();

  for (const t of list) {
    await store.put(t);
  }

  await tx.done;
}

export async function putTaskLocal(task: any) {
  await (await db()).put("tasks", task);
}

export async function getAllTasksLocal() {
  return (await (await db()).getAll("tasks")) || [];
}

export async function removeTaskLocal(id: string) {
  await (await db()).delete("tasks", id);
}

export async function promoteLocalToServer(
  clienteId: string,
  serverId: string
) {
  const d = await db();

  const task = await d.get("tasks", clienteId);

  if (task) {
    await d.delete("tasks", clienteId);

    task._id = serverId;
    task.pending = false;

    await d.put("tasks", task);
  }
}

export type OutboxOp =
  | {
      id: string;
      op: "create";
      clienteId: string;
      data: any;
      ts: number;
    }
  | {
      id: string;
      op: "update";
      serverId?: string;
      clienteId?: string;
      data: any;
      ts: number;
    }
  | {
      id: string;
      op: "delete";
      serverId?: string;
      clienteId?: string;
      ts: number;
    };

export async function queue(op: OutboxOp) {
  await (await db()).put("outbox", op);
}

export async function getOutbox() {
  return (await (await db()).getAll("outbox")) || [];
}

export async function clearOutbox() {
  const tx = (await db()).transaction("outbox", "readwrite");

  await tx.objectStore("outbox").clear();

  await tx.done;
}

export async function setMapping(
  clienteId: string,
  serverId: string
) {
  await (await db()).put("meta", {
    key: clienteId,
    serverId,
  });
}

export async function getMapping(clienteId: string) {
  return (
    (await (await db()).get("meta", clienteId))
      ?.serverId as string | undefined
  );
}