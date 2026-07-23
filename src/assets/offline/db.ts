import { openDB } from "idb";

let dbp: ReturnType<typeof openDB>;

const isLocalTaskId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

export type LocalTask = {
  _id: string;
  title?: string;
  description?: string;
  status?: string;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};

export type OutboxOp =
  | {
      id: string;
      op: "create";
      clienteId: string;
      data: Partial<LocalTask>;
      ts: number;
    }
  | {
      id: string;
      op: "update";
      serverId?: string;
      clienteId?: string;
      data: Partial<LocalTask>;
      ts: number;
    }
  | {
      id: string;
      op: "delete";
      serverId?: string;
      clienteId?: string;
      ts: number;
    };

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

export async function cacheTasks(list: LocalTask[]) {
  const database = await db();
  const storedTasks = ((await database.getAll("tasks")) || []) as LocalTask[];
  const outbox = ((await database.getAll("outbox")) || []) as OutboxOp[];
  const deletedIds = new Set(
    outbox
      .filter((op) => op.op === "delete")
      .flatMap((op) => [op.serverId, op.clienteId].filter(Boolean) as string[])
  );
  const pendingTasks = storedTasks.filter((task) => {
    const id = String(task._id || "");

    return id && !task.deleted && !deletedIds.has(id) && (task.pending || isLocalTaskId(id));
  });
  const tx = database.transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");

  await store.clear();

  for (const t of list) {
    const id = String(t._id || "");
    if (!id || deletedIds.has(id)) continue;
    await store.put(t);
  }

  for (const task of pendingTasks) {
    await store.put(task);
  }

  await tx.done;
}

export async function putTaskLocal(task: LocalTask) {
  await (await db()).put("tasks", task);
}

export async function getAllTasksLocal(): Promise<LocalTask[]> {
  return (((await (await db()).getAll("tasks")) || []) as LocalTask[]).filter(
    (task) => !task.deleted
  );
}

export async function removeTaskLocal(id: string) {
  await (await db()).delete("tasks", id);
}

export async function promoteLocalToServer(
  clienteId: string,
  serverId: string
) {
  const d = await db();

  const task = (await d.get("tasks", clienteId)) as LocalTask | undefined;

  if (task) {
    await d.delete("tasks", clienteId);

    task._id = serverId;
    task.pending = false;

    await d.put("tasks", task);
  }
}

export async function queue(op: OutboxOp) {
  const database = await db();

  if (op.op === "delete" && op.clienteId && !op.serverId) {
    await database.delete("outbox", `op-${op.clienteId}`);
    await database.delete("outbox", `upd-${op.clienteId}`);
    await database.delete("outbox", op.id);
    return;
  }

  if (op.op === "delete" && op.serverId) {
    await database.delete("outbox", `upd-${op.serverId}`);
  }

  const current = (await database.get("outbox", op.id)) as OutboxOp | undefined;
  const next =
    current?.op === "update" && op.op === "update"
      ? {
          ...current,
          ...op,
          data: {
            ...current.data,
            ...op.data,
          },
          ts: op.ts,
        }
      : op;

  await database.put("outbox", next);
}

export async function getOutbox(): Promise<OutboxOp[]> {
  return (((await (await db()).getAll("outbox")) || []) as OutboxOp[]).sort(
    (a, b) => a.ts - b.ts
  );
}

export async function clearOutbox() {
  const tx = (await db()).transaction("outbox", "readwrite");

  await tx.objectStore("outbox").clear();

  await tx.done;
}

export async function removeOutbox(id: string) {
  await (await db()).delete("outbox", id);
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
