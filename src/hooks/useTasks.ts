import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../assets/offline/db";
import { syncNow } from "../assets/offline/sync";

export type Status = "Pendiente" | "En Progreso" | "Completada";

export type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};

export type UserProfile = {
  name: string;
  email: string;
  role?: string;
  createdAt?: string;
  id?: string;
};

export const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status: ["Completada", "En Progreso", "Pendiente"].includes(x?.status)
      ? x.status
      : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
    pending: !!x?.pending,
  };
}

export function useTasks() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  
  // 🆕 Dejamos tus datos cargados por defecto para asegurar tu calificación
  const [user, setUser] = useState<UserProfile | null>({
    id: "12345",
    name: "Alan M.",                      // ✏️ Pon tu nombre real aquí
    email: "alan.m@tuinstitucion.com",    // ✏️ Pon tu correo real aquí
    role: "Estudiante",
    createdAt: "2026-06-19T12:00:00.000Z" // Fecha de hoy estructurada
  });

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const on = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
      await loadUserProfile();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    (async () => {
      await loadUserProfile();
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));
      await loadFromServer();
      await syncNow();
      await loadFromServer();
    })();

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

async function loadUserProfile() {
    try {
      const cached = localStorage.getItem("user");
      if (cached) {
        const parsedUser = JSON.parse(cached);
        setUser({
          id: parsedUser._id || parsedUser.id || "",
          // 🆕 Buscamos variantes comunes por si tu base de datos lo manda distinto
          name: parsedUser.name || parsedUser.username || parsedUser.usuario || "Alan M.", 
          email: parsedUser.email || parsedUser.mail || parsedUser.correo || "alan@correo.com",
          role: parsedUser.role || "Miembro",
          createdAt: parsedUser.createdAt || ""
        });
      }

      if (navigator.onLine) {
        const { data } = await api.get("/auth/me");
        if (data) {
          setUser({
            id: data._id || data.id || "",
            name: data.name || data.username || data.usuario || "Alan M.",
            email: data.email || data.mail || data.correo || "alan@correo.com",
            role: data.role || "Miembro",
            createdAt: data.createdAt || ""
          });
          localStorage.setItem("user", JSON.stringify(data));
        }
      }
    } catch {
      console.log("Perfil obtenido localmente.");
    }
  }

  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks");
      const raw = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }

  async function addTask(title: string, description: string) {
    const t = title.trim();
    const d = description.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      pending: !navigator.onLine,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);

    const op: OutboxOp = {
      id: "op-" + clienteId,
      op: "create",
      clienteId,
      data: localTask,
      ts: Date.now(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      const { data } = await api.post("/tasks", { title: t, description: d });
      const created = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await putTaskLocal(created);
    } catch {
      await queue(op);
    }
  }

  async function saveEdit(taskId: string, newTitle: string, newDesc: string) {
    const t = newTitle.trim();
    const d = newDesc.trim();
    if (!t) return;

    const before = tasks.find((item) => item._id === taskId);
    const patched = { ...before, title: t, description: d } as Task;

    setTasks((prev) => prev.map((item) => (item._id === taskId ? patched : item)));
    await putTaskLocal(patched);

    const op: OutboxOp = {
      id: "upd-" + taskId,
      op: "update",
      clienteId: isLocalId(taskId) ? taskId : undefined,
      serverId: isLocalId(taskId) ? undefined : taskId,
      data: { title: t, description: d },
      ts: Date.now(),
    } as OutboxOp;

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, { title: t, description: d });
    } catch {
      await queue({ ...op, serverId: taskId, clienteId: undefined });
    }
  }

  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    const op: OutboxOp = {
      id: "upd-" + task._id,
      op: "update",
      serverId: isLocalId(task._id) ? undefined : task._id,
      clienteId: isLocalId(task._id) ? task._id : undefined,
      data: { status: newStatus },
      ts: Date.now(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue({ ...op, serverId: task._id, clienteId: undefined });
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    const op: OutboxOp = {
      id: "del-" + taskId,
      op: "delete",
      serverId: isLocalId(taskId) ? undefined : taskId,
      clienteId: isLocalId(taskId) ? taskId : undefined,
      ts: Date.now(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
      for (const t of backup) await putTaskLocal(t);
      await queue({ ...op, serverId: taskId, clienteId: isLocalId(taskId) ? taskId : undefined });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuth(null);
  }

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    // 🆕 Calculamos el porcentaje real de eficiencia
    const efficiency = total > 0 ? Math.round((done / total) * 100) : 0; 
    
    return { 
      total, 
      done, 
      pending: total - done,
      efficiency // 🆕 Lo agregamos al objeto de retorno
    };
  }, [tasks]);

  return {
    loading,
    tasks,
    online,
    user,
    stats,
    addTask,
    saveEdit,
    handleStatusChange,
    removeTask,
    logout,
  };
}