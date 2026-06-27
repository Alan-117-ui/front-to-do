import { useMemo, useState } from "react";
import { useTasks, isLocalId, type Status, type Task } from "../hooks/useTasks";
import "../App.css";

export default function Dashboard() {
  // ⚓ Consumo de nuestro Hook Limpio
  const {
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
  } = useTasks();

  // Estados locales temporales únicamente para los inputs de la vista
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [showProfile, setShowProfile] = useState(false);

  // Manejadores locales de envío
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    addTask(title, description);
    setTitle("");
    setDescription("");
  };

  const startEdit = (task: Task) => {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  };

  const handleSaveEdit = (taskId: string) => {
    saveEdit(taskId, editingTitle, editingDescription);
    setEditingId(null);
  };

  // Filtrado reactivo en UI
  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(s) ||
          (t.description || "").toLowerCase().includes(s)
      );
    }
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const userInitial = useMemo(() => (user?.name ? user.name.charAt(0).toUpperCase() : "?"), [user]);

  // Función de renderizado interna para mantener el acceso al estado de edición y Handlers
  const renderTaskContent = (t: Task) => {
    return (
      <>
        <div className="card-top-actions">
          <select
            value={t.status}
            onChange={(e) => handleStatusChange(t, e.target.value as Status)}
            className="status-select"
            title="Estado"
          >
            <option value="Pendiente">Pendiente</option>
            <option value="En Progreso">En Progreso</option>
            <option value="Completada">Completada</option>
          </select>
        </div>

        <div className="content" style={{ margin: "10px 0" }}>
          {editingId === t._id ? (
            <>
              <input
                className="edit"
                style={{ width: "100%", marginBottom: "5px", padding: "6px", background: "var(--bg-dark)", border: "1px solid var(--border-soft)", color: "#fff", borderRadius: "4px" }}
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                placeholder="Título"
                autoFocus
              />
              <textarea
                className="edit"
                style={{ width: "100%", padding: "6px", background: "var(--bg-dark)", border: "1px solid var(--border-soft)", color: "#fff", borderRadius: "4px" }}
                value={editingDescription}
                onChange={(e) => setEditingDescription(e.target.value)}
                placeholder="Descripción"
                rows={2}
              />
            </>
          ) : (
            <>
              <span className="title" style={{ display: "block", fontWeight: "bold", textDecoration: t.status === "Completada" ? "line-through" : "none", color: t.status === "Completada" ? "var(--text-gray)" : "inherit" }} onDoubleClick={() => startEdit(t)}>
                {t.title}
              </span>
              {t.description && <p className="desc" style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-gray)" }}>{t.description}</p>}
              {(t.pending || isLocalId(t._id)) && (
                <span className="badge" title="Aún no sincronizada" style={{ background: "#b45309", width: "fit-content", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", display: "inline-block", marginTop: "6px", fontWeight: "bold", color: "#fff" }}>
                  Falta sincronizar
                </span>
              )}
            </>
          )}
        </div>

        <div className="actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid var(--border-soft)", paddingTop: "8px" }}>
          {editingId === t._id ? (
            <button className="btn" style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => handleSaveEdit(t._id)}>
              Guardar
            </button>
          ) : (
            <button className="icon" title="Editar" onClick={() => startEdit(t)}>
              ✏️
            </button>
          )}
          <button className="icon danger" title="Eliminar" onClick={() => removeTask(t._id)}>
            🗑️
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="dashboard-container">
      {/* 🔹 SIDEBAR LATERAL IZQUIERDO */}
      <aside className="sidebar">
        <div className="brand">
          <h1>To-Do PWA</h1>
          <span className={`status-badge ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"}
          </span>
        </div>

        {/* Tarjeta estática de Perfil del Alumno */}
        <div className="profile-card-sidebar">
          <div className="avatar-circle" onClick={() => setShowProfile(!showProfile)} style={{ cursor: "pointer" }}>
            {userInitial}
          </div>
          <div className="profile-details">
            <h3>{user?.name || "Alan M."}</h3>
            <p>{user?.email || "alan.m@tuinstitucion.com"}</p>
            <span className="role-tag">{user?.role || "Estudiante"}</span>
          </div>
          <button onClick={logout} className="logout-mini-btn" title="Cerrar Sesión">✕</button>
        </div>

        {/* Sección de Estadísticas en el Menú */}
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
            <span style={{ color: "var(--text-gray)" }}>Eficiencia:</span>
            <span style={{ color: "var(--primary-glow)", fontWeight: "bold" }}>{stats.efficiency || 0}%</span>
          </div>
        </div>

        {/* Formulario integrado en el Sidebar */}
        <div className="add-task-box">
          <h4>Nueva Tarea</h4>
          <form className="add-grid" onSubmit={handleAddTask}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título de la tarea…"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción (opcional)…"
              rows={3}
            />
            <button type="submit" className="btn-submit">Agregar Actividad</button>
          </form>
        </div>
      </aside>

      {/* 🔹 CONTENIDO PRINCIPAL (Buscador y Tablero Kanban) */}
      <main className="main-content">
        <header className="top-search-bar" style={{ display: "flex", gap: "15px", alignItems: "center", justifyContent: "space-between" }}>
          <input
            type="text"
            className="search-input"
            placeholder="🔍 Buscar por título o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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

        {/* ===== Tablero Kanban Reorganizado ===== */}
        {loading ? (
          <p style={{ textAlign: "center", color: "var(--text-gray)", padding: "40px" }}>Cargando actividades…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas en este filtro</p>
        ) : (
          <div className="kanban-board">
            
            {/* 📌 COLUMNA 1: PENDIENTES */}
            <div className="kanban-column">
              <div className="column-header pendiente">
                <span>📌 Pendientes</span>
                <span className="counter-badge">
                  {filtered.filter(t => t.status === "Pendiente").length}
                </span>
              </div>
              <div className="column-body">
                {filtered.filter(t => t.status === "Pendiente").length === 0 ? (
                  <div className="empty-ghost">Sin pendientes</div>
                ) : (
                  filtered.filter(t => t.status === "Pendiente").map((t) => (
                    <div key={t._id} className="kanban-card">
                      {renderTaskContent(t)}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ⚡ COLUMNA 2: EN PROGRESO */}
            <div className="kanban-column">
              <div className="column-header progreso">
                <span>⚡ En Progreso</span>
                <span className="counter-badge">
                  {filtered.filter(t => t.status === "En Progreso").length}
                </span>
              </div>
              <div className="column-body">
                {filtered.filter(t => t.status === "En Progreso").length === 0 ? (
                  <div className="empty-ghost">Sin actividad</div>
                ) : (
                  filtered.filter(t => t.status === "En Progreso").map((t) => (
                    <div key={t._id} className="kanban-card in-progress">
                      {renderTaskContent(t)}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ✅ COLUMNA 3: COMPLETADAS */}
            <div className="kanban-column">
              <div className="column-header completada">
                <span>✅ Hechas</span>
                <span className="counter-badge">
                  {filtered.filter(t => t.status === "Completada").length}
                </span>
              </div>
              <div className="column-body">
                {filtered.filter(t => t.status === "Completada").length === 0 ? (
                  <div className="empty-ghost">Nada completado</div>
                ) : (
                  filtered.filter(t => t.status === "Completada").map((t) => (
                    <div key={t._id} className="kanban-card finished">
                      {renderTaskContent(t)}
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