import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

type ColumnConfig = {
  status: Status;
  title: string;
  empty: string;
  tone: "pending" | "progress" | "done";
};

const ADMIN_EMAIL = "alanmorales117@gmail.com";

const DEFAULT_USER: UserProfile = {
  id: "12345",
  name: "Morales",
  email: ADMIN_EMAIL,
  role: "admin",
  createdAt: "2026-06-19T12:00:00.000Z",
};

const COLUMNS: ColumnConfig[] = [
  { status: "Pendiente", title: "Pendientes", empty: "Sin pendientes", tone: "pending" },
  { status: "En Progreso", title: "En progreso", empty: "Sin actividad", tone: "progress" },
  { status: "Completada", title: "Hechas", empty: "Nada completado", tone: "done" },
];

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
  const email =
    readString(record.email) ||
    readString(record.mail) ||
    readString(record.correo) ||
    DEFAULT_USER.email;

  return {
    id: readString(record._id) || readString(record.id),
    name:
      readString(record.name) ||
      readString(record.username) ||
      readString(record.usuario) ||
      DEFAULT_USER.name,
    email,
    role: email.toLowerCase() === ADMIN_EMAIL ? "admin" : readString(record.role) || "Miembro",
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

function getStatusTone(status: Status) {
  if (status === "Completada") return "done";
  if (status === "En Progreso") return "progress";
  return "pending";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [user, setUser] = useState<UserProfile | null>(DEFAULT_USER);

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [draggingId, setDraggingId] = useState("");

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }, []);

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
      // Mantiene el perfil local si no hay respuesta del servidor.
    }
  }, []);

  const loadFromServer = useCallback(async () => {
    try {
      const { data } = await api.get<unknown>("/tasks");
      const list = readTasksResponse(data).map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // El cache local mantiene el tablero usable sin conexion.
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
      showNotice("Conexion recuperada. Tablero actualizado.");
    };
    const handleOffline = () => {
      setOnline(false);
      showNotice("Estas offline. Los cambios se guardaran localmente.");
    };

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
  }, [loadFromServer, loadUserProfile, showNotice]);

  async function refreshDashboard() {
    setRefreshing(true);
    try {
      await syncNow();
      await loadFromServer();
      await loadUserProfile();
      showNotice(online ? "Tablero actualizado." : "Estas offline. Mostrando datos locales.");
    } finally {
      setRefreshing(false);
    }
  }

  async function addTask(newTitle: string, newDescription: string) {
    const cleanTitle = newTitle.trim();
    const cleanDescription = newDescription.trim();
    if (!cleanTitle) {
      showNotice("No se agrego la tarea: falta el titulo.");
      return;
    }

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
      showNotice("Tarea guardada localmente.");
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
      showNotice("Tarea agregada.");
    } catch {
      await queue(op);
      const pendingTask = { ...localTask, pending: true };
      setTasks((prev) =>
        prev.map((item) => (item._id === clienteId ? pendingTask : item))
      );
      await putTaskLocal(pendingTask);
      showNotice("No hubo conexion. Se sincronizara despues.");
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
      showNotice("Edicion guardada localmente.");
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, {
        title: cleanTitle,
        description: cleanDescription,
      });
      const synced = { ...patched, pending: false };
      setTasks((prev) => prev.map((item) => (item._id === taskId ? synced : item)));
      await putTaskLocal(synced);
      showNotice("Tarea actualizada.");
    } catch {
      await queue(op);
      const pendingTask = { ...patched, pending: true };
      setTasks((prev) =>
        prev.map((item) => (item._id === taskId ? pendingTask : item))
      );
      await putTaskLocal(pendingTask);
      showNotice("Edicion pendiente de sincronizar.");
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
      showNotice("Estado guardado localmente.");
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
      const synced = { ...updated, pending: false };
      setTasks((prev) => prev.map((item) => (item._id === task._id ? synced : item)));
      await putTaskLocal(synced);
      showNotice("Estado actualizado.");
    } catch {
      await queue(op);
      const pendingTask = { ...updated, pending: true };
      setTasks((prev) =>
        prev.map((item) => (item._id === task._id ? pendingTask : item))
      );
      await putTaskLocal(pendingTask);
      showNotice("Estado pendiente de sincronizar.");
    }
  }

  async function removeTask(taskId: string) {
    setTasks((prev) => prev.filter((item) => item._id !== taskId));
    await removeTaskLocal(taskId);

    const op: OutboxOp = {
      id: "del-" + taskId,
      op: "delete",
      clienteId: isLocalId(taskId) ? taskId : undefined,
      serverId: isLocalId(taskId) ? undefined : taskId,
      ts: getTimestamp(),
    };

    if (!navigator.onLine || isLocalId(taskId)) {
      await queue(op);
      showNotice("Tarea eliminada localmente.");
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
      showNotice("Tarea eliminada.");
    } catch {
      await queue(op);
      showNotice("Tarea eliminada. Se sincronizara despues.");
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
    const progress = tasks.filter((task) => task.status === "En Progreso").length;
    const pending = tasks.filter((task) => task.status === "Pendiente").length;
    const efficiency = total > 0 ? Math.round((done / total) * 100) : 0;
    const syncPending = tasks.filter((task) => task.pending || isLocalId(task._id)).length;

    return { total, done, progress, pending, efficiency, syncPending };
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

  const groupedTasks = useMemo(
    () => ({
      Pendiente: filtered.filter((task) => task.status === "Pendiente"),
      "En Progreso": filtered.filter((task) => task.status === "En Progreso"),
      Completada: filtered.filter((task) => task.status === "Completada"),
    }),
    [filtered]
  );

  const userInitial = useMemo(
    () => (user?.name ? user.name.charAt(0).toUpperCase() : "?"),
    [user]
  );
  const firstName = useMemo(() => user?.name?.split(" ")[0] || DEFAULT_USER.name, [user]);
  const isAdmin = useMemo(() => {
    const role = (user?.role || "").toLowerCase();
    const email = (user?.email || "").toLowerCase();
    return role.includes("admin") || email === ADMIN_EMAIL;
  }, [user]);

  const handleAddTask = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError("Agrega un titulo para poder crear la tarea.");
      showNotice("No se agrego la tarea: falta el titulo.");
      return;
    }

    setTitleError("");
    void addTask(title, description);
    setTitle("");
    setDescription("");
  };

  const startEdit = (task: Task) => {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
    setEditingDescription("");
  };

  const handleSaveEdit = (taskId: string) => {
    if (!editingTitle.trim()) {
      showNotice("Agrega un titulo para guardar la tarea.");
      return;
    }

    void saveEdit(taskId, editingTitle, editingDescription);
    cancelEdit();
  };

  const startDragTask = (event: React.DragEvent<HTMLElement>, taskId: string) => {
    setDraggingId(taskId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
  };

  const allowTaskDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const dropTaskInColumn = (event: React.DragEvent<HTMLElement>, status: Status) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggingId;
    const task = tasks.find((item) => item._id === taskId);

    setDraggingId("");
    if (!task || task.status === status) return;

    void handleStatusChange(task, status);
  };

  const renderTaskContent = (task: Task) => {
    const isCompleted = task.status === "Completada";
    const nextStatus = isCompleted ? "Pendiente" : "Completada";

    return (
      <>
        <div className="task-card-header">
          <div className={`status-pill ${getStatusTone(task.status)}`}>
            <span className="status-dot" />
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
        </div>

        <div className="task-card-content">
          {editingId === task._id ? (
            <div className="edit-stack">
              <input
                className="edit"
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
                placeholder="Titulo"
                autoFocus
              />
              <textarea
                className="edit"
                value={editingDescription}
                onChange={(event) => setEditingDescription(event.target.value)}
                placeholder="Descripcion"
                rows={3}
              />
            </div>
          ) : (
            <>
              <button className="task-title-button" type="button" onDoubleClick={() => startEdit(task)}>
                <span className={isCompleted ? "task-title completed" : "task-title"}>
                  {task.title}
                </span>
              </button>
              {task.description && <p className="desc">{task.description}</p>}
              {(task.pending || isLocalId(task._id)) && (
                <span className="badge sync-badge">Falta sincronizar</span>
              )}
            </>
          )}
        </div>

        <div className="task-card-actions">
          {editingId === task._id ? (
            <>
              <button className="btn compact" type="button" onClick={() => handleSaveEdit(task._id)}>
                Guardar
              </button>
              <button className="icon" type="button" onClick={cancelEdit}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button className="icon" type="button" onClick={() => startEdit(task)}>
                Editar
              </button>
              <button
                className="icon"
                type="button"
                onClick={() => void handleStatusChange(task, nextStatus)}
              >
                {isCompleted ? "Reabrir" : "Completar"}
              </button>
            </>
          )}
          <button className="icon danger" type="button" onClick={() => void removeTask(task._id)}>
            Eliminar
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">TD</div>
          <div className="brand-copy">
            <span>Tablero personal</span>
            <h1>To-Do PWA</h1>
          </div>
        </div>

        <div className={`connection-card ${online ? "online" : "offline"}`}>
          <span className="connection-dot" />
          <div>
            <strong>{online ? "Online" : "Offline"}</strong>
            <p>{online ? "Sincronizacion activa" : "Guardando cambios locales"}</p>
          </div>
        </div>

        <div className="profile-card-sidebar">
          <div className="avatar-circle">{userInitial}</div>
          <div className="profile-details">
            <h3>{user?.name || DEFAULT_USER.name}</h3>
            <p>{user?.email || DEFAULT_USER.email}</p>
            <span className="role-tag">{user?.role || DEFAULT_USER.role}</span>
          </div>
          <button onClick={logout} className="logout-mini-btn" title="Cerrar sesion">
            Salir
          </button>
        </div>

        {isAdmin && (
          <Link className="admin-entry" to="/admin">
            <span>Panel admin</span>
            <strong>Usuarios, roles y bloqueos</strong>
          </Link>
        )}

        <div className="sidebar-panel">
          <div className="panel-title">
            <span>Avance</span>
            <strong>{stats.efficiency}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${stats.efficiency}%` }} />
          </div>
          <div className="mini-stats">
            <span>{stats.pending} pendientes</span>
            <span>{stats.progress} en curso</span>
            <span>{stats.done} hechas</span>
          </div>
        </div>

        <div className="add-task-box">
          <div className="section-heading">
            <h2>Nueva tarea</h2>
            <p>Agrega una actividad rapida al tablero.</p>
          </div>
          <form className="add-grid" onSubmit={handleAddTask}>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError("");
              }}
              placeholder="Titulo de la tarea"
              aria-label="Titulo de la tarea"
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? "task-title-error" : undefined}
            />
            {titleError && (
              <p className="field-error" id="task-title-error">
                {titleError}
              </p>
            )}
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Descripcion opcional"
              aria-label="Descripcion opcional"
              rows={4}
            />
            <button type="submit" className="btn-submit">
              Agregar actividad
            </button>
          </form>
        </div>
      </aside>

      <main className="main-content">
        <section className="dashboard-hero">
          <div>
            <span className="eyebrow">Hola, {firstName}</span>
            <h2>Organiza tu dia con claridad.</h2>
            <p>
              Revisa prioridades, cambia estados y sincroniza tus tareas desde un
              solo tablero.
            </p>
          </div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => void refreshDashboard()}
            disabled={refreshing}
          >
            {refreshing ? "Actualizando..." : "Sincronizar"}
          </button>
        </section>

        <section className="metric-grid">
          <article className="metric-card">
            <span>Total</span>
            <strong>{stats.total}</strong>
            <p>Tareas registradas</p>
          </article>
          <article className="metric-card accent-pending">
            <span>Pendientes</span>
            <strong>{stats.pending}</strong>
            <p>Por iniciar</p>
          </article>
          <article className="metric-card accent-progress">
            <span>En curso</span>
            <strong>{stats.progress}</strong>
            <p>En movimiento</p>
          </article>
          <article className="metric-card accent-done">
            <span>Hechas</span>
            <strong>{stats.done}</strong>
            <p>{stats.syncPending} pendientes de sync</p>
          </article>
        </section>

        {notice && <div className="notice">{notice}</div>}

        <section className="board-toolbar">
          <div className="search-wrap">
            <span>Buscar</span>
            <input
              type="text"
              className="search-input"
              placeholder="Titulo o descripcion"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="filters">
            <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")} type="button">
              Todas
            </button>
            <button className={filter === "active" ? "chip active" : "chip"} onClick={() => setFilter("active")} type="button">
              Activas
            </button>
            <button className={filter === "completed" ? "chip active" : "chip"} onClick={() => setFilter("completed")} type="button">
              Hechas
            </button>
            {search && (
              <button className="chip subtle" onClick={() => setSearch("")} type="button">
                Limpiar
              </button>
            )}
          </div>
        </section>

        {loading ? (
          <div className="empty-state">Cargando actividades...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <strong>Sin tareas en este filtro</strong>
            <p>Cambia el filtro o crea una tarea nueva desde el panel lateral.</p>
          </div>
        ) : (
          <div className="kanban-board">
            {COLUMNS.map((column) => {
              const list = groupedTasks[column.status];

              return (
                <section
                  className={`kanban-column ${column.tone} ${draggingId ? "drop-ready" : ""}`}
                  key={column.status}
                  onDragOver={allowTaskDrop}
                  onDrop={(event) => dropTaskInColumn(event, column.status)}
                >
                  <div className="column-header">
                    <span>{column.title}</span>
                    <span className="counter-badge">{list.length}</span>
                  </div>
                  <div className="column-body">
                    {list.length === 0 ? (
                      <div className="empty-ghost">{column.empty}</div>
                    ) : (
                      list.map((task) => (
                        <article
                          key={task._id}
                          className={`kanban-card ${getStatusTone(task.status)} ${draggingId === task._id ? "dragging" : ""}`}
                          draggable={editingId !== task._id}
                          onDragStart={(event) => startDragTask(event, task._id)}
                          onDragEnd={() => setDraggingId("")}
                        >
                          {renderTaskContent(task)}
                        </article>
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
