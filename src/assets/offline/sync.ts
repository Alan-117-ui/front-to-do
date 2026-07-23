import { api } from "../../api";
import {
  getAllTasksLocal,
  getMapping,
  getOutbox,
  promoteLocalToServer,
  putTaskLocal,
  removeOutbox,
  removeTaskLocal,
  setMapping,
  type LocalTask,
  type OutboxOp,
} from "./db";

type SyncGroup = {
  key: string;
  ids: string[];
  clienteId?: string;
  serverId?: string;
  createData?: Partial<LocalTask>;
  updateData?: Partial<LocalTask>;
  deleteRequested: boolean;
};

const VALID_STATUS = new Set(["Pendiente", "En Progreso", "Completada"]);

let syncing = false;
let lastSyncAt = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function groupKey(op: OutboxOp) {
  if ("serverId" in op && op.serverId) return op.serverId;
  if ("clienteId" in op && op.clienteId) return op.clienteId;
  return op.id;
}

function mergeTaskData(
  current: Partial<LocalTask> | undefined,
  next: Partial<LocalTask> | undefined
) {
  return {
    ...(current || {}),
    ...(next || {}),
  };
}

function groupOutbox(ops: OutboxOp[]) {
  const groups = new Map<string, SyncGroup>();

  for (const op of ops) {
    const key = groupKey(op);
    let group = groups.get(key);

    if (!group) {
      group = {
        key,
        ids: [],
        deleteRequested: false,
      };
      groups.set(key, group);
    }

    if (!group.ids.includes(op.id)) group.ids.push(op.id);
    if ("clienteId" in op && op.clienteId) group.clienteId = op.clienteId;
    if ("serverId" in op && op.serverId) group.serverId = op.serverId;

    if (op.op === "create") {
      group.createData = mergeTaskData(op.data, group.updateData);
      group.updateData = undefined;
    }

    if (op.op === "update") {
      if (group.createData) {
        group.createData = mergeTaskData(group.createData, op.data);
      } else {
        group.updateData = mergeTaskData(group.updateData, op.data);
      }
    }

    if (op.op === "delete") {
      group.deleteRequested = true;
    }
  }

  return [...groups.values()];
}

function mapLocalTasks(tasks: LocalTask[]) {
  const map = new Map<string, LocalTask>();

  for (const task of tasks) {
    if (task._id) map.set(task._id, task);
    if (task.clienteId) map.set(task.clienteId, task);
  }

  return map;
}

function getLocalTask(group: SyncGroup, tasks: Map<string, LocalTask>) {
  return (
    (group.serverId ? tasks.get(group.serverId) : undefined) ||
    (group.clienteId ? tasks.get(group.clienteId) : undefined)
  );
}

function cleanStatus(value: unknown) {
  const status = readString(value);
  return VALID_STATUS.has(status) ? status : "Pendiente";
}

function createPayload(source: Partial<LocalTask> | undefined) {
  return {
    title: readString(source?.title, "(sin titulo)").trim() || "(sin titulo)",
    description: readString(source?.description),
    status: cleanStatus(source?.status),
  };
}

function updatePayload(source: Partial<LocalTask> | undefined) {
  const payload: Partial<Pick<LocalTask, "title" | "description" | "status">> = {};

  if (source?.title !== undefined) {
    payload.title = readString(source.title, "(sin titulo)").trim() || "(sin titulo)";
  }

  if (source?.description !== undefined) {
    payload.description = readString(source.description);
  }

  if (source?.status !== undefined) {
    payload.status = cleanStatus(source.status);
  }

  return payload;
}

function readMappedServerId(data: unknown, clienteId?: string) {
  const record = asRecord(data);
  const mapping = Array.isArray(record._mapping)
    ? record._mapping
    : Array.isArray(record.mapping)
      ? record.mapping
      : [];

  for (const item of mapping) {
    const row = asRecord(item);
    const rowClientId = readString(row.clienteId) || readString(row.clientId);
    const rowServerId =
      readString(row.serverId) || readString(row._id) || readString(row.id) || readString(row.taskId);

    if (rowServerId && (!clienteId || rowClientId === clienteId)) return rowServerId;
  }

  const task = asRecord(record.task || record.item || data);
  return readString(task._id) || readString(task.id);
}

async function finishGroup(group: SyncGroup) {
  for (const id of new Set(group.ids)) {
    await removeOutbox(id);
  }
}

async function createServerTask(group: SyncGroup, source: Partial<LocalTask>) {
  const payload = createPayload(source);

  try {
    const { data } = await api.post("/tasks", payload);
    const serverId = readMappedServerId(data, group.clienteId);
    if (!serverId) throw new Error("No server task id returned");
    return serverId;
  } catch (firstError: unknown) {
    try {
      const { data } = await api.post("/tasks/bulksync", {
        tasks: [
          {
            clienteId: group.clienteId,
            ...payload,
          },
        ],
      });
      const serverId = readMappedServerId(data, group.clienteId);
      if (!serverId) throw firstError;
      return serverId;
    } catch {
      throw firstError;
    }
  }
}

async function syncDelete(group: SyncGroup) {
  if (group.createData && !group.serverId) {
    if (group.clienteId) await removeTaskLocal(group.clienteId);
    await finishGroup(group);
    return;
  }

  const serverId = group.serverId || (group.clienteId ? await getMapping(group.clienteId) : undefined);

  if (!serverId) {
    await finishGroup(group);
    return;
  }

  await api.delete(`/tasks/${serverId}`);

  await removeTaskLocal(serverId);
  if (group.clienteId) await removeTaskLocal(group.clienteId);
  await finishGroup(group);
}

async function syncCreate(group: SyncGroup, localTasks: Map<string, LocalTask>) {
  const localTask = getLocalTask(group, localTasks);
  const source = mergeTaskData(group.createData, localTask);
  const serverId = await createServerTask(group, source);

  if (group.clienteId) {
    await setMapping(group.clienteId, serverId);
    await promoteLocalToServer(group.clienteId, serverId);
  }

  await putTaskLocal({
    ...source,
    _id: serverId,
    pending: false,
  });
  await finishGroup(group);
}

async function syncUpdate(group: SyncGroup, localTasks: Map<string, LocalTask>) {
  const serverId = group.serverId || (group.clienteId ? await getMapping(group.clienteId) : undefined);
  const localTask = getLocalTask(group, localTasks);

  if (!serverId) {
    if (!group.clienteId) return;

    await syncCreate(
      {
        ...group,
        createData: mergeTaskData(group.updateData, localTask),
        updateData: undefined,
      },
      localTasks
    );
    return;
  }

  const payload = updatePayload(mergeTaskData(group.updateData, localTask));

  if (!Object.keys(payload).length) {
    await finishGroup(group);
    return;
  }

  await api.put(`/tasks/${serverId}`, payload);

  if (localTask) {
    await putTaskLocal({
      ...localTask,
      ...payload,
      _id: serverId,
      pending: false,
    });
  }

  await finishGroup(group);
}

export async function syncNow() {
  if (!navigator.onLine) return;

  const now = Date.now();
  if (now - lastSyncAt < 1500) return;
  lastSyncAt = now;

  if (syncing) return;
  syncing = true;

  try {
    const ops = await getOutbox();
    if (!ops.length) return;

    const localTasks = mapLocalTasks(await getAllTasksLocal());
    const groups = groupOutbox(ops);

    for (const group of groups) {
      if (!group.deleteRequested) continue;

      try {
        await syncDelete(group);
      } catch {
        // Queda en outbox para reintentar en la proxima conexion.
      }
    }

    for (const group of groups) {
      if (group.deleteRequested) continue;

      try {
        if (group.createData) {
          await syncCreate(group, localTasks);
        } else if (group.updateData) {
          await syncUpdate(group, localTasks);
        }
      } catch {
        // Queda en outbox para reintentar en la proxima conexion.
      }
    }
  } finally {
    syncing = false;
  }
}

export function setupOnlineSync() {
  const handler = () => {
    void syncNow();
  };

  window.addEventListener("online", handler);

  return () => window.removeEventListener("online", handler);
}
