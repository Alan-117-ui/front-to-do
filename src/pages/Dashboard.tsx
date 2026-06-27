import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import "../App.css";

type Status = "Pendiente" | "En Progreso" | "Completada";

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};

type UserProfile = {
  name: string;
  email: string;
  role?: string;
  createdAt?: string;
  id?: string;
};

const DEFAULT_USER: UserProfile = {
  id: "12345",
  name: "Alan M.",
  email: "alan.m@tuinstitucion.com",
  role: "Estudiante",
  createdAt: "2026-06-19T12:00:00.000Z",
};

const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeTask(value: unknown): Task {
  const record = asRecord(value);
  const id = record._id ?? record.id;
  const status = readString(record.status);

  return {
    _id: String(id ?? ""),
    title: readString(record.title, "(sin titulo)"),
    description: readString(record.description),
    status: ["Completada", "En Progreso", "Pendiente"].includes(status)
      ? (status as Status)
      : "Pendiente",
    clienteId: readString(record.clienteId) || undefined,
    createdAt: readString(record.createdAt) || undefined,
    deleted: !!record.deleted,
    pending: !!record.pending,
  };
}

function readTasksResponse(data: unknown) {
  const record = asRecord(data);
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.tasks)) return record.tasks;
  if (Array.isArray(data)) return data;
  return [];
}

function normalizeUser(value: unknown): UserProfile {
  const record = asRecord(value);

  return {
    id: readString(record._id) || readString(record.id),
    name:
      readString(record.name) ||
      readString(record.username) ||
      readString(record.usuario) ||
      DEFAULT_USER.name,
    email:
      readString(record.email) ||
      readString(record.mail) ||
      readString(record.correo) ||
      DEFAULT_USER.email,
    role: readString(record.role) || "Miembro",
    createdAt: readString(record.createdAt),
  };
}

function getLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}`;
}

function getTimestamp() {
  return Date.now();
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [user, setUser] = useState<UserProfile | null>(DEFAULT_USER);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");

  const loadUserProfile = useCallback(async () => {
    try {
      const cached = localStorage.getItem("user");
      if (cached) {
        setUser(normalizeUser(JSON.parse(cached) as unknown));
      }

      if (navigator.onLine) {
        const { data } = await api.get<unknown>("/auth/me");
        if (data) {
          setUser(normalizeUser(data));
          localStorage.setItem("user", JSON.stringify(data));
        }
      }
    } catch {
      // Se conserva el perfil local si el servidor no responde.
    }
  }, []);

  const loadFromServer = useCallback(async () => {
    try {
      const { data } = await api.get<unknown>("/tasks");
      const list = readTasksResponse(data).map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // El cache local mantiene el dashboard usable cuando no hay conexion.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const handleOnline = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
      await loadUserProfile();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void (async () => {
      await loadUserProfile();
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));
      await loadFromServer();
      await syncNow();
      await loadFromServer();
    })();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadFromServer, loadUserProfile]);

  async function addTask(newTitle: string, newDescription: string) {
    const cleanTitle = newTitle.trim();
    const cleanDescription = newDescription.trim();
    if (!cleanTitle) return;

    const clienteId = getLocalId();
    const localTask = normalizeTask({
      _id: clienteId,
      title: cleanTitle,
      description: cleanDescription,
      status: "Pendiente",
      pending: !navigator.onLine,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);

    const op: OutboxOp = {
      id: "op-" + clienteId,
      op: "create",
      clienteId,
      data: localTask,
      ts: getTimestamp(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      const { data } = await api.post<unknown>("/tasks", {
        title: cleanTitle,
        description: cleanDescription,
      });
      const created = normalizeTask(asRecord(data).task ?? data);
      setTasks((prev) => prev.map((item) => (item._id === clienteId ? created : item)));
      await removeTaskLocal(clienteId);
      await putTaskLocal(created);
    } catch {
      await queue(op);
      setTasks((prev) =>
        prev.map((item) => (item._id === clienteId ? { ...item, pending: true } : item))
      );
    }
  }

  async function saveEdit(taskId: string, newTitle: string, newDescription: string) {
    const cleanTitle = newTitle.trim();
    const cleanDescription = newDescription.trim();
    if (!cleanTitle) return;

    const before = tasks.find((item) => item._id === taskId);
    if (!before) return;

    const patched = {
      ...before,
      title: cleanTitle,
      description: cleanDescription,
      pending: before.pending || !navigator.onLine,
    };

    setTasks((prev) => prev.map((item) => (item._id === taskId ? patched : item)));
    await putTaskLocal(patched);

    const op: OutboxOp = {
      id: "upd-" + taskId,
      op: "update",
      clienteId: isLocalId(taskId) ? taskId : undefined,
      serverId: isLocalId(taskId) ? undefined : taskId,
      data: { title: cleanTitle, description: cleanDescription },
      ts: getTimestamp(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, {
        title: cleanTitle,
        description: cleanDescription,
      });
    } catch {
      await queue(op);
      setTasks((prev) =>
        prev.map((item) => (item._id === taskId ? { ...item, pending: true } : item))
      );
    }
  }

  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus, pending: task.pending || !navigator.onLine };
    setTasks((prev) => prev.map((item) => (item._id === task._id ? updated : item)));
    await putTaskLocal(updated);

    const op: OutboxOp = {
      id: "upd-" + task._id,
      op: "update",
      clienteId: isLocalId(task._id) ? task._id : undefined,
      serverId: isLocalId(task._id) ? undefined : task._id,
      data: { status: newStatus },
      ts: getTimestamp(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue(op);
      setTasks((prev) =>
        prev.map((item) => (item._id === task._id ? { ...item, pending: true } : item))
      );
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((item) => item._id !== taskId));
    await removeTaskLocal(taskId);

    const op: OutboxOp = {
      id: "del-" + taskId,
      op: "delete",
      clienteId: isLocalId(taskId) ? taskId : undefined,
      serverId: isLocalId(taskId) ? undefined : taskId,
      ts: getTimestamp(),
    };

    if (!navigator.onLine) {
      await queue(op);
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
      for (const task of backup) await putTaskLocal(task);
      await queue(op);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuth(null);
    navigate("/", { replace: true });
  }

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((task) => task.status === "Completada").length;
    const efficiency = total > 0 ? Math.round((done / total) * 100) : 0;

    return { total, done, pending: total - done, efficiency };
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const value = search.toLowerCase();
      list = list.filter(
        (task) =>
          (task.title || "").toLowerCase().includes(value) ||
          (task.description || "").toLowerCase().includes(value)
      );
    }

    if (filter === "active") list = list.filter((task) => task.status !== "Completada");
    if (filter === "completed") list = list.filter((task) => task.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const pendingTasks = useMemo(() => filtered.filter((task) => task.status === "Pendiente"), [filtered]);
  const progressTasks = useMemo(() => filtered.filter((task) => task.status === "En Progreso"), [filtered]);
  const completedTasks = useMemo(() => filtered.filter((task) => task.status === "Completada"), [filtered]);

  const userInitial = useMemo(
    () => (user?.name ? user.name.charAt(0).toUpperCase() : "?"),
    [user]
  );

  const handleAddTask = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void addTask(title, description);
    setTitle("");
    setDescription("");
  };

  const startEdit = (task: Task) => {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  };

  const handleSaveEdit = (taskId: string) => {
    if (!editingTitle.trim()) return;
    void saveEdit(taskId, editingTitle, editingDescription);
    setEditingId(null);
  };

  const renderTaskContent = (task: Task) => {
    const isCompleted = task.status === "Completada";

    return (
      <>
        <div className="card-top-actions">
          <select
            value={task.status}
            onChange={(event) => void handleStatusChange(task, event.target.value as Status)}
            className="status-select"
            title="Estado"
          >
            <option value="Pendiente">Pendiente</option>
            <option value="En Progreso">En Progreso</option>
            <option value="Completada">Completada</option>
          </select>
        </div>

        <div className="content" style={{ margin: "10px 0" }}>
          {editingId === task._id ? (
            <>
              <input
                className="edit"
                style={{ width: "100%", marginBottom: "5px", padding: "6px", background: "var(--bg-dark)", border: "1px solid var(--border-soft)", color: "#fff", borderRadius: "4px" }}
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
                placeholder="Titulo"
                autoFocus
              />
              <textarea
                className="edit"
                style={{ width: "100%", padding: "6px", background: "var(--bg-dark)", border: "1px solid var(--border-soft)", color: "#fff", borderRadius: "4px" }}
                value={editingDescription}
                onChange={(event) => setEditingDescription(event.target.value)}
                placeholder="Descripcion"
                rows={2}
              />
            </>
          ) : (
            <>
              <span
                className="title"
                style={{
                  display: "block",
                  fontWeight: "bold",
                  textDecoration: isCompleted ? "line-through" : "none",
                  color: isCompleted ? "var(--text-gray)" : "inherit",
                }}
                onDoubleClick={() => startEdit(task)}
              >
                {task.title}
              </span>
              {task.description && (
                <p className="desc" style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-gray)" }}>
                  {task.description}
                </p>
              )}
              {(task.pending || isLocalId(task._id)) && (
                <span
                  className="badge"
                  title="Aun no sincronizada"
                  style={{ background: "#b45309", width: "fit-content", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", display: "inline-block", marginTop: "6px", fontWeight: "bold", color: "#fff" }}
                >
                  Falta sincronizar
                </span>
              )}
            </>
          )}
        </div>

        <div className="actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid var(--border-soft)", paddingTop: "8px" }}>
          {editingId === task._id ? (
            <button className="btn" style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => handleSaveEdit(task._id)}>
              Guardar
            </button>
          ) : (
            <button className="icon" title="Editar" onClick={() => startEdit(task)}>
              Editar
            </button>
          )}
          <button className="icon danger" title="Eliminar" onClick={() => void removeTask(task._id)}>
            Eliminar
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="brand">
          <h1>To-Do PWA</h1>
          <span className={`status-badge ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"}
          </span>
        </div>

        <div className="profile-card-sidebar">
          <div className="avatar-circle">{userInitial}</div>
          <div className="profile-details">
            <h3>{user?.name || DEFAULT_USER.name}</h3>
            <p>{user?.email || DEFAULT_USER.email}</p>
            <span className="role-tag">{user?.role || DEFAULT_USER.role}</span>
          </div>
          <button onClick={logout} className="logout-mini-btn" title="Cerrar Sesion">
            x
          </button>
        </div>

        <div style={{ backgroundColor: "var(--bg-dark)", border: "1px solid var(--border-soft)", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-gray)" }}>Total:</span>
            <span>{stats.total}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-gray)" }}>Hechas:</span>
            <span style={{ color: "var(--color-hecha)" }}>{stats.done}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-gray)" }}>Pendientes:</span>
            <span style={{ color: "var(--color-pendiente)" }}>{stats.pending}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-gray)" }}>Eficiencia:</span>
            <span style={{ color: "var(--primary-glow)", fontWeight: "bold" }}>{stats.efficiency}%</span>
          </div>
        </div>

        <div className="add-task-box">
          <h4>Nueva Tarea</h4>
          <form className="add-grid" onSubmit={handleAddTask}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Titulo de la tarea..."
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Descripcion (opcional)..."
              rows={3}
            />
            <button type="submit" className="btn-submit">
              Agregar Actividad
            </button>
          </form>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-search-bar" style={{ display: "flex", gap: "15px", alignItems: "center", justifyContent: "space-between" }}>
          <input
            type="text"
            className="search-input"
            placeholder="Buscar por titulo o descripcion..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="filters" style={{ display: "flex", gap: "6px" }}>
            <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")} type="button">
              Todas
            </button>
            <button className={filter === "active" ? "chip active" : "chip"} onClick={() => setFilter("active")} type="button">
              Activas
            </button>
            <button className={filter === "completed" ? "chip active" : "chip"} onClick={() => setFilter("completed")} type="button">
              Hechas
            </button>
          </div>
        </header>

        {loading ? (
          <p style={{ textAlign: "center", color: "var(--text-gray)", padding: "40px" }}>
            Cargando actividades...
          </p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas en este filtro</p>
        ) : (
          <div className="kanban-board">
            <div className="kanban-column">
              <div className="column-header pendiente">
                <span>Pendientes</span>
                <span className="counter-badge">{pendingTasks.length}</span>
              </div>
              <div className="column-body">
                {pendingTasks.length === 0 ? (
                  <div className="empty-ghost">Sin pendientes</div>
                ) : (
                  pendingTasks.map((task) => (
                    <div key={task._id} className="kanban-card">
                      {renderTaskContent(task)}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="kanban-column">
              <div className="column-header progreso">
                <span>En Progreso</span>
                <span className="counter-badge">{progressTasks.length}</span>
              </div>
              <div className="column-body">
                {progressTasks.length === 0 ? (
                  <div className="empty-ghost">Sin actividad</div>
                ) : (
                  progressTasks.map((task) => (
                    <div key={task._id} className="kanban-card in-progress">
                      {renderTaskContent(task)}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="kanban-column">
              <div className="column-header completada">
                <span>Hechas</span>
                <span className="counter-badge">{completedTasks.length}</span>
              </div>
              <div className="column-body">
                {completedTasks.length === 0 ? (
                  <div className="empty-ghost">Nada completado</div>
                ) : (
                  completedTasks.map((task) => (
                    <div key={task._id} className="kanban-card finished">
                      {renderTaskContent(task)}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
