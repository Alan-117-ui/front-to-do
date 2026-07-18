import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import "../App.css";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  online: boolean;
  active: boolean;
  banned: boolean;
  blocked: boolean;
  lastSeen?: string;
  createdAt?: string;
};

type UserAction = "ban" | "block" | "active" | "admin";

type AdminUserDraft = {
  name: string;
  email: string;
  role: string;
};

const ADMIN_EMAIL = "alanmorales117@gmail.com";
const ADMIN_USER_CACHE = "admin_users_cache";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function pickArray(data: unknown) {
  const record = asRecord(data);
  if (Array.isArray(data)) return data;
  if (Array.isArray(record.users)) return record.users;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.data)) return record.data;
  return [];
}

function normalizeUser(value: unknown): AdminUser {
  const record = asRecord(value);
  const id = record._id ?? record.id ?? record.uid ?? record.email;
  const email =
    readString(record.email) ||
    readString(record.mail) ||
    readString(record.correo) ||
    ADMIN_EMAIL;
  const banned = readBoolean(record.banned) || readBoolean(record.isBanned);
  const blocked = readBoolean(record.blocked) || readBoolean(record.isBlocked);
  const active =
    record.active === undefined && record.isActive === undefined
      ? !banned && !blocked
      : readBoolean(record.active, readBoolean(record.isActive, true));

  return {
    id: String(id ?? ""),
    name:
      readString(record.name) ||
      readString(record.username) ||
      readString(record.usuario) ||
      "Morales",
    email,
    role: email.toLowerCase() === ADMIN_EMAIL ? "admin" : readString(record.role, "usuario"),
    online: readBoolean(record.online) || readBoolean(record.isOnline),
    active,
    banned,
    blocked,
    lastSeen:
      readString(record.lastSeen) ||
      readString(record.lastLogin) ||
      readString(record.updatedAt),
    createdAt: readString(record.createdAt),
  };
}

function getCurrentUser() {
  try {
    return normalizeUser(JSON.parse(localStorage.getItem("user") || "{}") as unknown);
  } catch {
    return normalizeUser({});
  }
}

function loadCachedUsers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ADMIN_USER_CACHE) || "[]") as unknown;
    const cached = pickArray(parsed).map(normalizeUser);
    const current = getCurrentUser();

    if (current.id && !cached.some((user) => user.id === current.id)) {
      return [{ ...current, role: current.role || "admin", online: true }, ...cached];
    }

    return cached;
  } catch {
    const current = getCurrentUser();
    return current.id ? [{ ...current, online: true }] : [];
  }
}

function saveCachedUsers(users: AdminUser[]) {
  localStorage.setItem(ADMIN_USER_CACHE, JSON.stringify(users));
}

async function getAdminUsersFromApi() {
  const endpoints = ["/admin/users", "/users", "/auth/users"];
  let lastError: unknown;

  for (const endpoint of endpoints) {
    try {
      const { data } = await api.get<unknown>(endpoint);
      const users = pickArray(data).map(normalizeUser).filter((user) => user.id);
      if (users.length) return users;
    } catch (error: unknown) {
      lastError = error;
    }
  }

  throw lastError;
}

async function patchAdminUser(userId: string, payload: Record<string, unknown>) {
  const endpoints = [`/admin/users/${userId}`, `/users/${userId}`, `/auth/users/${userId}`];
  const bodies = [payload, { user: payload }, { updates: payload }];
  let lastError: unknown;

  for (const endpoint of endpoints) {
    for (const body of bodies) {
      try {
        await api.patch(endpoint, body);
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    for (const body of bodies) {
      try {
        await api.put(endpoint, body);
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }
  }

  throw lastError;
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>(() => loadCachedUsers());
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "active" | "blocked" | "banned">("all");
  const [notice, setNotice] = useState("");
  const [localMode, setLocalMode] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<AdminUserDraft>({
    name: "",
    email: "",
    role: "usuario",
  });

  const currentUser = useMemo(() => getCurrentUser(), []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const loadUsers = useCallback(async () => {
    setRefreshing(true);
    setAuth(localStorage.getItem("token"));

    try {
      const list = await getAdminUsersFromApi();
      setUsers(list);
      saveCachedUsers(list);
      setLocalMode(false);
    } catch {
      const cached = loadCachedUsers();
      setUsers(cached);
      setLocalMode(true);
      showNotice("Modo local: conecta las rutas admin del backend para aplicar bloqueos reales.");
    } finally {
      setRefreshing(false);
    }
  }, [showNotice]);

  const stats = useMemo(() => {
    const total = users.length;
    const online = users.filter((user) => user.online).length;
    const active = users.filter((user) => user.active && !user.banned && !user.blocked).length;
    const blocked = users.filter((user) => user.blocked).length;
    const banned = users.filter((user) => user.banned).length;

    return { total, online, active, blocked, banned };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query);

      if (!matchesSearch) return false;
      if (filter === "online") return user.online;
      if (filter === "active") return user.active && !user.blocked && !user.banned;
      if (filter === "blocked") return user.blocked;
      if (filter === "banned") return user.banned;
      return true;
    });
  }, [filter, search, users]);

  async function updateUser(user: AdminUser, action: UserAction) {
    const next: AdminUser = { ...user };

    if (action === "ban") {
      next.banned = !user.banned;
      if (next.banned) {
        next.active = false;
        next.online = false;
      }
    }

    if (action === "block") {
      next.blocked = !user.blocked;
      if (next.blocked) {
        next.active = false;
        next.online = false;
      }
    }

    if (action === "active") {
      next.active = !user.active;
      if (next.active) {
        next.banned = false;
        next.blocked = false;
      }
    }

    if (action === "admin") {
      next.role = user.role.toLowerCase().includes("admin") ? "usuario" : "admin";
    }

    const nextUsers = users.map((item) => (item.id === user.id ? next : item));

    setSavingId(user.id);
    setUsers(nextUsers);
    saveCachedUsers(nextUsers);

    try {
      if (!localMode) {
        await patchAdminUser(user.id, {
          role: next.role,
          active: next.active,
          banned: next.banned,
          blocked: next.blocked,
          isBanned: next.banned,
          isBlocked: next.blocked,
          online: next.online,
        });
      }
      showNotice("Usuario actualizado.");
    } catch {
      setLocalMode(true);
      showNotice("Cambio guardado en modo local. El backend no acepto la accion todavia.");
    } finally {
      setSavingId("");
    }
  }

  function startEditUser(user: AdminUser) {
    setEditingId(user.id);
    setDraft({
      name: user.name,
      email: user.email,
      role: user.role,
    });
  }

  function cancelEditUser() {
    setEditingId("");
    setDraft({ name: "", email: "", role: "usuario" });
  }

  async function saveUserDetails(user: AdminUser) {
    const cleanName = draft.name.trim();
    const cleanEmail = draft.email.trim().toLowerCase();
    const cleanRole = cleanEmail === ADMIN_EMAIL ? "admin" : draft.role.trim() || "usuario";

    if (!cleanName || !cleanEmail) {
      showNotice("Nombre y correo son obligatorios.");
      return;
    }

    const next: AdminUser = {
      ...user,
      name: cleanName,
      email: cleanEmail,
      role: cleanRole,
    };
    const nextUsers = users.map((item) => (item.id === user.id ? next : item));

    setSavingId(user.id);
    setUsers(nextUsers);
    saveCachedUsers(nextUsers);

    try {
      if (!localMode) {
        await patchAdminUser(user.id, {
          name: next.name,
          email: next.email,
          role: next.role,
        });
      }

      showNotice("Datos del usuario actualizados.");
      cancelEditUser();
    } catch {
      setLocalMode(true);
      showNotice("Datos guardados en modo local. El backend no acepto la edicion todavia.");
      cancelEditUser();
    } finally {
      setSavingId("");
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuth(null);
    navigate("/", { replace: true });
  }

  return (
    <div className="admin-page">
      <aside className="admin-sidebar">
        <Link to="/dashboard" className="admin-back">
          Volver al dashboard
        </Link>
        <div>
          <span className="eyebrow">Panel privado</span>
          <h1>Administracion</h1>
          <p>Gestion de usuarios registrados, actividad, bloqueos y roles.</p>
        </div>
        <div className="admin-profile">
          <strong>{currentUser.name}</strong>
          <span>{currentUser.email}</span>
          <em>{currentUser.role || "admin"}</em>
        </div>
        <button className="icon danger" type="button" onClick={logout}>
          Cerrar sesion
        </button>
      </aside>

      <main className="admin-main">
        <section className="admin-hero">
          <div>
            <span className="eyebrow">Control de acceso</span>
            <h2>Usuarios, bloqueos y actividad en tiempo real.</h2>
            <p>
              Bannea, bloquea, cambia roles y revisa quien esta online o activo.
            </p>
          </div>
          <button className="btn secondary" type="button" onClick={() => void loadUsers()} disabled={refreshing}>
            {refreshing ? "Actualizando..." : "Actualizar usuarios"}
          </button>
        </section>

        <section className="admin-stats">
          <article><span>Total</span><strong>{stats.total}</strong></article>
          <article><span>Online</span><strong>{stats.online}</strong></article>
          <article><span>Activos</span><strong>{stats.active}</strong></article>
          <article><span>Bloqueados</span><strong>{stats.blocked}</strong></article>
          <article><span>Baneados</span><strong>{stats.banned}</strong></article>
        </section>

        {localMode && (
          <div className="notice">
            Modo local activo. La UI esta lista, pero el backend debe guardar roles, bans y bloqueos.
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}

        <section className="admin-toolbar">
          <div className="search-wrap">
            <span>Buscar usuario</span>
            <input
              className="search-input"
              placeholder="Nombre, correo o rol"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="filters">
            <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")} type="button">Todos</button>
            <button className={filter === "online" ? "chip active" : "chip"} onClick={() => setFilter("online")} type="button">Online</button>
            <button className={filter === "active" ? "chip active" : "chip"} onClick={() => setFilter("active")} type="button">Activos</button>
            <button className={filter === "blocked" ? "chip active" : "chip"} onClick={() => setFilter("blocked")} type="button">Bloqueados</button>
            <button className={filter === "banned" ? "chip active" : "chip"} onClick={() => setFilter("banned")} type="button">Baneados</button>
          </div>
        </section>

        <section className="admin-table-card">
          <div className="admin-table-title">
            <div>
              <span className="eyebrow">Usuarios registrados</span>
              <h2>Gestionar usuarios</h2>
            </div>
            <strong>{filteredUsers.length} visibles</strong>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="empty-state">
              <strong>No hay usuarios en este filtro</strong>
              <p>Prueba con otro filtro o usa Actualizar usuarios cuando quieras consultar el backend.</p>
            </div>
          ) : (
            <div className="admin-user-list">
              {filteredUsers.map((user) => {
                const isCurrent = user.id === currentUser.id || user.email === currentUser.email;
                const isAdmin = user.role.toLowerCase().includes("admin");

                return (
                  <article className="admin-user-card" key={user.id}>
                    <div className="admin-user-main">
                      <div className="admin-avatar">{user.name.charAt(0).toUpperCase()}</div>
                      <div>
                        <h3>{user.name}</h3>
                        <p>{user.email}</p>
                        <div className="admin-badges">
                          <span className={isAdmin ? "role-badge admin" : "role-badge"}>{user.role}</span>
                          <span className={user.online ? "state-badge online" : "state-badge"}>{user.online ? "Online" : "Offline"}</span>
                          <span className={user.active ? "state-badge active" : "state-badge"}>{user.active ? "Activo" : "Inactivo"}</span>
                          {user.blocked && <span className="state-badge blocked">Bloqueado</span>}
                          {user.banned && <span className="state-badge banned">Baneado</span>}
                        </div>
                      </div>
                    </div>
                    <div className="admin-user-meta">
                      <span>Ultima actividad</span>
                      <strong>{user.lastSeen ? new Date(user.lastSeen).toLocaleString() : "Sin registro"}</strong>
                    </div>
                    <div className="admin-actions">
                      <button className="icon" type="button" disabled={savingId === user.id} onClick={() => startEditUser(user)}>
                        Editar datos
                      </button>
                      <button className="icon" type="button" disabled={savingId === user.id || isCurrent} onClick={() => void updateUser(user, "admin")}>
                        {isAdmin ? "Quitar admin" : "Hacer admin"}
                      </button>
                      <button className="icon" type="button" disabled={savingId === user.id || isCurrent} onClick={() => void updateUser(user, "active")}>
                        {user.active ? "Desactivar" : "Activar"}
                      </button>
                      <button className="icon" type="button" disabled={savingId === user.id || isCurrent} onClick={() => void updateUser(user, "block")}>
                        {user.blocked ? "Desbloquear" : "Bloquear"}
                      </button>
                      <button className="icon danger" type="button" disabled={savingId === user.id || isCurrent} onClick={() => void updateUser(user, "ban")}>
                        {user.banned ? "Quitar ban" : "Banear"}
                      </button>
                    </div>
                    {editingId === user.id && (
                      <form className="admin-edit-form" onSubmit={(event) => {
                        event.preventDefault();
                        void saveUserDetails(user);
                      }}>
                        <label>
                          Nombre
                          <input
                            value={draft.name}
                            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                            placeholder="Nombre del usuario"
                          />
                        </label>
                        <label>
                          Correo
                          <input
                            type="email"
                            value={draft.email}
                            onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
                            placeholder="correo@dominio.com"
                          />
                        </label>
                        <label>
                          Rol
                          <select
                            value={draft.role}
                            onChange={(event) => setDraft((prev) => ({ ...prev, role: event.target.value }))}
                          >
                            <option value="usuario">usuario</option>
                            <option value="admin">admin</option>
                            <option value="moderador">moderador</option>
                          </select>
                        </label>
                        <div className="admin-edit-actions">
                          <button className="btn compact" type="submit" disabled={savingId === user.id}>
                            Guardar datos
                          </button>
                          <button className="icon" type="button" onClick={cancelEditUser}>
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
